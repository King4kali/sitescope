import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { deleteObject, validatePublicUrl } from '@sitescope/core';
import { z } from 'zod';
import { Database } from './db.js';
import { apiError, type AuthRequest, id, lockUser, pageOptions, parse } from './http.js';
import { config } from './config.js';

const projectSchema = z
  .object({ name: z.string().trim().min(1).max(80), url: z.string().trim().min(1).max(2048) })
  .strict();
export const auditSummary = {
  results: true,
  _count: { select: { findings: true } },
} satisfies Prisma.AuditInclude;
export async function ensureOwnedProject(
  db: Database | Prisma.TransactionClient,
  projectId: string,
  ownerId: string,
) {
  const project = await db.project.findFirst({ where: { id: id(projectId), ownerId } });
  if (!project) apiError(404, 'NOT_FOUND', 'The project was not found.');
  return project;
}
export async function ensureOwnedAudit(
  db: Database | Prisma.TransactionClient,
  auditId: string,
  ownerId: string,
) {
  const audit = await db.audit.findFirst({
    where: { id: id(auditId), project: { ownerId } },
    include: { project: true },
  });
  if (!audit) apiError(404, 'NOT_FOUND', 'The audit was not found.');
  return audit;
}
export async function ensureDeletable(
  tx: Prisma.TransactionClient,
  ownerId: string,
  projectId?: string,
) {
  const where = { project: { ownerId, ...(projectId ? { id: projectId } : {}) } };
  const active = await tx.audit.count({
    where: { ...where, status: { in: ['QUEUED', 'RUNNING'] } },
  });
  const activeExports = await tx.export.count({
    where: { audit: where, status: { in: ['QUEUED', 'RUNNING'] } },
  });
  if (active || activeExports)
    apiError(
      409,
      'WORK_IN_PROGRESS',
      'Wait for active audits and PDF exports to finish before deleting this data.',
    );
}
export async function cleanupStoredData(
  tx: Prisma.TransactionClient,
  ownerId: string,
  projectId?: string,
) {
  const auditWhere = { project: { ownerId, ...(projectId ? { id: projectId } : {}) } };
  const [artifacts, exports, audits] = await Promise.all([
    tx.artifact.findMany({ where: { audit: auditWhere }, select: { storageKey: true } }),
    tx.export.findMany({
      where: { audit: auditWhere, storageKey: { not: null } },
      select: { storageKey: true, id: true },
    }),
    tx.audit.findMany({ where: auditWhere, select: { id: true } }),
  ]);
  const keys = new Set([
    ...artifacts.map((a) => a.storageKey),
    ...exports.flatMap((e) => (e.storageKey ? [e.storageKey] : [])),
  ]);
  try {
    for (const key of keys) await deleteObject(key);
  } catch {
    apiError(
      503,
      'STORAGE_UNAVAILABLE',
      'File storage is unavailable. Your deletion was not completed; please retry.',
    );
  }
  const ids = [...audits.map((a) => a.id), ...exports.map((e) => e.id)];
  if (ids.length) await tx.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
}

@Injectable()
export class ProjectsService {
  constructor(@Inject(Database) private readonly db: Database) {}
  async list(ownerId: string, query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = pageOptions(query);
    const search = parse(z.string().max(100).default(''), query.search);
    const sort = parse(z.enum(['updatedAt', 'createdAt', 'name']).default('updatedAt'), query.sort);
    const direction = parse(
      z.enum(['asc', 'desc']).default(sort === 'name' ? 'asc' : 'desc'),
      query.direction,
    );
    const where: Prisma.ProjectWhereInput = {
      ownerId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { origin: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.project.findMany({
        where,
        skip,
        take,
        orderBy: { [sort]: direction },
        include: {
          audits: { take: 1, orderBy: { createdAt: 'desc' }, include: auditSummary },
          _count: { select: { audits: true } },
        },
      }),
      this.db.project.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
  async create(ownerId: string, body: unknown) {
    const input = parse(projectSchema, body);
    let origin: string;
    try {
      const url = await validatePublicUrl(input.url);
      url.hash = '';
      origin = url.href;
    } catch {
      apiError(
        400,
        'UNSAFE_URL',
        'Enter a public HTTP or HTTPS URL using port 80 or 443. Private networks and credentials are not allowed.',
      );
    }
    return this.db.$transaction(async (tx) => {
      await lockUser(tx, ownerId);
      if ((await tx.project.count({ where: { ownerId } })) >= config.MAX_PROJECTS)
        apiError(
          429,
          'PROJECT_LIMIT',
          `Your account can contain up to ${config.MAX_PROJECTS} projects.`,
        );
      return tx.project.create({ data: { ownerId, name: input.name, origin } });
    });
  }
  async detail(ownerId: string, projectId: string) {
    const project = await this.db.project.findFirst({
      where: { id: id(projectId), ownerId },
      include: {
        audits: { take: 20, orderBy: { createdAt: 'desc' }, include: auditSummary },
        _count: { select: { audits: true } },
      },
    });
    if (!project) apiError(404, 'NOT_FOUND', 'The project was not found.');
    return project;
  }
  async rename(ownerId: string, projectId: string, body: unknown) {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }).strict(), body);
    await ensureOwnedProject(this.db, projectId, ownerId);
    await this.db.project.updateMany({ where: { id: projectId, ownerId }, data: { name } });
    return this.detail(ownerId, projectId);
  }
  async remove(ownerId: string, projectId: string) {
    await this.db.$transaction(
      async (tx) => {
        await lockUser(tx, ownerId);
        await ensureOwnedProject(tx, projectId, ownerId);
        await ensureDeletable(tx, ownerId, projectId);
        await cleanupStoredData(tx, ownerId, projectId);
        await tx.project.delete({ where: { id: projectId } });
      },
      { timeout: 60000 },
    );
    return { message: 'Project and associated reports have been deleted.' };
  }
}

@ApiTags('Projects')
@ApiCookieAuth()
@Controller('projects')
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}
  @Get() list(@Req() req: AuthRequest, @Query() query: Record<string, unknown>) {
    return this.projects.list(req.user.id, query);
  }
  @Post() create(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.projects.create(req.user.id, body);
  }
  @Get(':id') detail(@Req() req: AuthRequest, @Param('id') projectId: string) {
    return this.projects.detail(req.user.id, projectId);
  }
  @Patch(':id') rename(
    @Req() req: AuthRequest,
    @Param('id') projectId: string,
    @Body() body: unknown,
  ) {
    return this.projects.rename(req.user.id, projectId, body);
  }
  @Delete(':id') remove(@Req() req: AuthRequest, @Param('id') projectId: string) {
    return this.projects.remove(req.user.id, projectId);
  }
}
