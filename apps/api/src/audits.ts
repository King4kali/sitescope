import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { DEFAULT_LIMITS, getObject, validatePublicUrl } from '@sitescope/core';
import type { Response } from 'express';
import { z } from 'zod';
import { Database } from './db.js';
import { config } from './config.js';
import {
  apiError,
  type AuthRequest,
  id,
  lockUser,
  pageOptions,
  parse,
  utcDayStart,
} from './http.js';
import { auditSummary, ensureOwnedAudit, ensureOwnedProject } from './projects.js';
import { QueueService } from './queue.js';

const terminal = ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'];
const auditInclude = {
  project: true,
  results: true,
  findings: { orderBy: { id: 'asc' as const } },
  pages: true,
  artifacts: true,
  events: { orderBy: { createdAt: 'asc' as const }, take: 500 },
} satisfies Prisma.AuditInclude;
export function presentAudit<T extends { artifacts: { id: string; storageKey: string }[] }>(
  audit: T,
) {
  return {
    ...audit,
    artifacts: audit.artifacts.map(({ storageKey: _private, ...a }) => ({
      ...a,
      url: `/api/v1/artifacts/${a.id}`,
    })),
  };
}

@Injectable()
export class AuditsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(QueueService) private readonly queue: QueueService,
  ) {}
  async start(req: AuthRequest, projectId: string, body: unknown) {
    parse(z.object({}).strict(), body ?? {});
    if (!req.user.emailVerifiedAt)
      apiError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address before running an audit.');
    const project = await ensureOwnedProject(this.db, projectId, req.user.id);
    try {
      await validatePublicUrl(project.origin);
    } catch {
      apiError(
        400,
        'UNSAFE_URL',
        'The project URL no longer resolves to an allowed public address.',
      );
    }
    const key = req.get('idempotency-key');
    if (key !== undefined)
      parse(
        z
          .string()
          .min(8)
          .max(128)
          .regex(/^[a-zA-Z0-9_.-]+$/),
        key,
      );
    const idempotencyKey = key
      ? createHash('sha256').update(`${req.user.id}:${key}`).digest('hex')
      : undefined;
    const audit = await this.db.$transaction(async (tx) => {
      await lockUser(tx, req.user.id);
      await ensureOwnedProject(tx, projectId, req.user.id);
      if (idempotencyKey) {
        const existing = await tx.audit.findUnique({ where: { idempotencyKey } });
        if (existing) {
          if (existing.projectId !== projectId)
            apiError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'This idempotency key was used for another project.',
            );
          return existing;
        }
      }
      const currentUser = await tx.user.findUnique({ where: { id: req.user.id } });
      if (!currentUser || currentUser.blocked)
        apiError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
      const active = await tx.audit.count({
        where: { project: { ownerId: req.user.id }, status: { in: ['QUEUED', 'RUNNING'] } },
      });
      if (active)
        apiError(409, 'AUDIT_ALREADY_ACTIVE', 'Your account already has an active audit.');
      const today = await tx.usageEvent.count({
        where: {
          userId: req.user.id,
          eventType: 'AUDIT_STARTED',
          createdAt: { gte: utcDayStart() },
        },
      });
      if (today >= config.AUDITS_PER_DAY)
        apiError(
          429,
          'DAILY_AUDIT_LIMIT',
          `You have reached the daily limit of ${config.AUDITS_PER_DAY} audits. The limit resets at 00:00 UTC.`,
        );
      const record = await tx.audit.create({
        data: {
          projectId,
          targetUrl: project.origin,
          idempotencyKey,
          configJson: {
            maxPages: DEFAULT_LIMITS.pages,
            maxLinks: DEFAULT_LIMITS.links,
            maxRedirects: DEFAULT_LIMITS.redirects,
            maxBytes: DEFAULT_LIMITS.maxBytes,
            requestTimeoutMs: DEFAULT_LIMITS.requestTimeoutMs,
            auditTimeoutMs: config.AUDIT_TIMEOUT_MS,
          },
          events: {
            create: {
              eventType: 'QUEUED',
              stage: 'Queued',
              message: 'Audit accepted and waiting for a worker.',
            },
          },
        },
      });
      await tx.usageEvent.create({
        data: { userId: req.user.id, auditId: record.id, eventType: 'AUDIT_STARTED' },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateId: record.id,
          eventType: 'AUDIT_REQUESTED',
          payloadJson: { auditId: record.id },
        },
      });
      return record;
    });
    this.queue.kick();
    return { id: audit.id, status: audit.status, stage: audit.stage, progress: audit.progress };
  }
  async history(ownerId: string, projectId: string, query: Record<string, unknown>) {
    await ensureOwnedProject(this.db, projectId, ownerId);
    const { page, pageSize, skip, take } = pageOptions(query);
    const status = parse(
      z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']).optional(),
      query.status,
    );
    const where = { projectId, ...(status ? { status } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.audit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: auditSummary,
        skip,
        take,
      }),
      this.db.audit.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
  async detail(ownerId: string, auditId: string) {
    const audit = await this.db.audit.findFirst({
      where: { id: id(auditId), project: { ownerId } },
      include: auditInclude,
    });
    if (!audit) apiError(404, 'NOT_FOUND', 'The audit was not found.');
    return presentAudit(audit);
  }
  async findings(ownerId: string, auditId: string, query: Record<string, unknown>) {
    await ensureOwnedAudit(this.db, auditId, ownerId);
    const { page, pageSize, skip, take } = pageOptions(query);
    const severity = parse(
      z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
      query.severity,
    );
    const category = parse(
      z
        .enum([
          'performance',
          'seo',
          'links',
          'security',
          'accessibility',
          'http',
          'visual',
          'fieldData',
        ])
        .optional(),
      query.category,
    );
    const search = parse(z.string().max(100).optional(), query.search);
    const where: Prisma.FindingWhereInput = {
      auditId,
      ...(severity ? { severity } : {}),
      ...(category ? { category } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.finding.findMany({
        where,
        orderBy: [{ severity: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.db.finding.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
  async events(req: AuthRequest, auditId: string, res: Response) {
    await ensureOwnedAudit(this.db, auditId, req.user.id);
    res
      .status(200)
      .set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    let active = false;
    let last = '';
    let closed = false;
    let timer: NodeJS.Timeout | undefined;
    const cleanup = () => {
      closed = true;
      if (timer) clearInterval(timer);
    };
    req.on('close', cleanup);
    const tick = async () => {
      if (active || closed) return;
      active = true;
      try {
        // A long-lived stream must not bypass a session revocation or administrative block.
        const session = await this.db.session.findFirst({
          where: {
            id: req.sessionId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
            user: { blocked: false },
          },
        });
        if (!session) {
          cleanup();
          res.end();
          return;
        }
        const audit = await this.db.audit.findFirst({
          where: { id: auditId, project: { ownerId: req.user.id } },
          include: { results: true, _count: { select: { findings: true } } },
        });
        if (!audit) {
          cleanup();
          res.end();
          return;
        }
        const json = JSON.stringify(audit);
        if (json !== last) {
          last = json;
          res.write(`data: ${json}\n\n`);
        } else res.write(': heartbeat\n\n');
        if (terminal.includes(audit.status)) {
          cleanup();
          res.end();
        }
      } catch {
        res.write('event: error\ndata: {"code":"STREAM_INTERRUPTED"}\n\n');
        cleanup();
        res.end();
      } finally {
        active = false;
      }
    };
    timer = setInterval(() => {
      void tick();
    }, 2000);
    timer.unref();
    await tick();
  }
  async createExport(ownerId: string, auditId: string) {
    const result = await this.db.$transaction(async (tx) => {
      await lockUser(tx, ownerId);
      const audit = await ensureOwnedAudit(tx, auditId, ownerId);
      if (!terminal.includes(audit.status))
        apiError(
          409,
          'AUDIT_IN_PROGRESS',
          'Wait for the audit to finish before exporting a report.',
        );
      const existing = await tx.export.findFirst({
        where: { auditId, status: { in: ['QUEUED', 'RUNNING', 'COMPLETED'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) return existing;
      const record = await tx.export.create({ data: { auditId } });
      await tx.outboxEvent.create({
        data: {
          aggregateId: record.id,
          eventType: 'EXPORT_REQUESTED',
          payloadJson: { exportId: record.id },
        },
      });
      return record;
    });
    this.queue.kick();
    return this.exportStatus(ownerId, result.id);
  }
  async exportStatus(ownerId: string, exportId: string) {
    const record = await this.ownedExport(ownerId, exportId);
    return {
      id: record.id,
      status: record.status,
      ...(record.status === 'COMPLETED' && record.storageKey
        ? { url: `/api/v1/exports/${record.id}/file` }
        : {}),
      ...(record.errorCode ? { errorCode: record.errorCode } : {}),
    };
  }
  async exportFile(ownerId: string, exportId: string, res: Response) {
    const record = await this.ownedExport(ownerId, exportId);
    if (record.status !== 'COMPLETED' || !record.storageKey)
      apiError(409, 'EXPORT_NOT_READY', 'The PDF is not ready yet.');
    return sendStoredObject(
      record.storageKey,
      'application/pdf',
      `sitescope-${record.auditId}.pdf`,
      res,
      true,
    );
  }
  async artifact(ownerId: string, artifactId: string, res: Response) {
    const record = await this.db.artifact.findFirst({
      where: { id: id(artifactId), audit: { project: { ownerId } } },
    });
    if (!record || (record.expiresAt && record.expiresAt <= new Date()))
      apiError(404, 'NOT_FOUND', 'The file was not found.');
    // Only our known generated formats are served inline; HTML and SVG never execute on the app origin.
    const mimeType = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(
      record.mimeType,
    )
      ? record.mimeType
      : 'application/octet-stream';
    return sendStoredObject(
      record.storageKey,
      mimeType,
      `sitescope-${record.id}.${mimeType === 'application/pdf' ? 'pdf' : mimeType.split('/')[1] || 'bin'}`,
      res,
      mimeType === 'application/octet-stream',
    );
  }
  private async ownedExport(ownerId: string, exportId: string) {
    const record = await this.db.export.findFirst({
      where: { id: id(exportId), audit: { project: { ownerId } } },
    });
    if (!record) apiError(404, 'NOT_FOUND', 'The export was not found.');
    return record;
  }
}

async function sendStoredObject(
  key: string,
  mimeType: string,
  filename: string,
  res: Response,
  attachment = false,
) {
  try {
    const object = await getObject(key);
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `${attachment ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    // Core materializes storage objects as bounded buffers; ownership is checked before every fetch.
    res.send(object.body);
  } catch {
    apiError(503, 'FILE_UNAVAILABLE', 'The file is temporarily unavailable. Please try again.');
  }
}

@ApiTags('Audits')
@ApiCookieAuth()
@Controller()
export class AuditsController {
  constructor(@Inject(AuditsService) private readonly audits: AuditsService) {}
  @Post('projects/:id/audits') @HttpCode(202) start(
    @Req() req: AuthRequest,
    @Param('id') projectId: string,
    @Body() body: unknown,
  ) {
    return this.audits.start(req, projectId, body);
  }
  @Get('projects/:id/audits') history(
    @Req() req: AuthRequest,
    @Param('id') projectId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.audits.history(req.user.id, projectId, query);
  }
  @Get('audits/:id') detail(@Req() req: AuthRequest, @Param('id') auditId: string) {
    return this.audits.detail(req.user.id, auditId);
  }
  @Get('audits/:id/report') report(@Req() req: AuthRequest, @Param('id') auditId: string) {
    return this.audits.detail(req.user.id, auditId);
  }
  @Get('audits/:id/findings') findings(
    @Req() req: AuthRequest,
    @Param('id') auditId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.audits.findings(req.user.id, auditId, query);
  }
  @Get('audits/:id/events') events(
    @Req() req: AuthRequest,
    @Param('id') auditId: string,
    @Res() res: Response,
  ) {
    return this.audits.events(req, auditId, res);
  }
  @Post('audits/:id/exports') @HttpCode(202) createExport(
    @Req() req: AuthRequest,
    @Param('id') auditId: string,
  ) {
    return this.audits.createExport(req.user.id, auditId);
  }
  @Get('exports/:id') exportStatus(@Req() req: AuthRequest, @Param('id') exportId: string) {
    return this.audits.exportStatus(req.user.id, exportId);
  }
  @Get('exports/:id/file') exportFile(
    @Req() req: AuthRequest,
    @Param('id') exportId: string,
    @Res() res: Response,
  ) {
    return this.audits.exportFile(req.user.id, exportId, res);
  }
  @Get('artifacts/:id') artifact(
    @Req() req: AuthRequest,
    @Param('id') artifactId: string,
    @Res() res: Response,
  ) {
    return this.audits.artifact(req.user.id, artifactId, res);
  }
}
