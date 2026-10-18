import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { verify } from 'argon2';
import type { Response } from 'express';
import { z } from 'zod';
import { Database } from './db.js';
import { QueueService } from './queue.js';
import {
  Admin,
  apiError,
  type AuthRequest,
  id,
  lockUser,
  pageOptions,
  parse,
  publicUser,
  utcDayStart,
} from './http.js';
import { config, SESSION_COOKIE, sessionCookieOptions } from './config.js';
import { cleanupStoredData, ensureDeletable } from './projects.js';

@ApiTags('Profile')
@ApiCookieAuth()
@Controller('users/me')
export class UsersController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get() me(@Req() req: AuthRequest) {
    return { user: publicUser(req.user) };
  }
  @Get('usage') async usage(@Req() req: AuthRequest) {
    const today = utcDayStart();
    const [projects, auditsToday, activeAudits] = await this.db.$transaction([
      this.db.project.count({ where: { ownerId: req.user.id } }),
      this.db.usageEvent.count({
        where: { userId: req.user.id, eventType: 'AUDIT_STARTED', createdAt: { gte: today } },
      }),
      this.db.audit.count({
        where: { project: { ownerId: req.user.id }, status: { in: ['QUEUED', 'RUNNING'] } },
      }),
    ]);
    return {
      projects,
      maxProjects: config.MAX_PROJECTS,
      auditsToday,
      auditsPerDay: config.AUDITS_PER_DAY,
      activeAudits,
      resetsAt: new Date(today.getTime() + 86400000),
    };
  }
  @Patch() async update(@Req() req: AuthRequest, @Body() body: unknown) {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }).strict(), body);
    const user = await this.db.user.update({ where: { id: req.user.id }, data: { name } });
    return { user: publicUser(user) };
  }
  @Delete() async remove(
    @Req() req: AuthRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { password } = parse(z.object({ password: z.string().min(1).max(128) }).strict(), body);
    if (!(await verify(req.user.passwordHash, password).catch(() => false)))
      apiError(401, 'INVALID_PASSWORD', 'The password is incorrect.');
    await this.db.$transaction(
      async (tx) => {
        await lockUser(tx, req.user.id);
        const current = await tx.user.findUnique({ where: { id: req.user.id } });
        if (!current || current.passwordHash !== req.user.passwordHash)
          apiError(
            401,
            'INVALID_PASSWORD',
            'Your credentials changed. Sign in again to delete the account.',
          );
        await ensureDeletable(tx, req.user.id);
        await cleanupStoredData(tx, req.user.id);
        await tx.user.delete({ where: { id: req.user.id } });
      },
      { timeout: 60000 },
    );
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions, maxAge: undefined });
    return { message: 'Your account and associated data have been deleted.' };
  }
}

@ApiTags('Administration')
@ApiCookieAuth()
@Admin()
@Controller('admin')
export class AdminController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(QueueService) private readonly queue: QueueService,
  ) {}
  @Get('stats') async stats() {
    const [
      users,
      projects,
      activeAudits,
      failedAudits,
      artifacts,
      exports,
      duration,
      auditQueue,
      reportQueue,
      workers,
    ] = await Promise.all([
      this.db.user.count(),
      this.db.project.count(),
      this.db.audit.count({ where: { status: { in: ['QUEUED', 'RUNNING'] } } }),
      this.db.audit.count({ where: { status: 'FAILED' } }),
      this.db.artifact.aggregate({ _sum: { sizeBytes: true }, _count: true }),
      this.db.export.count({ where: { status: 'COMPLETED' } }),
      this.db.$queryRaw<
        { averageMs: number | null }[]
      >`SELECT AVG(EXTRACT(EPOCH FROM ("finishedAt" - "startedAt")) * 1000)::float AS "averageMs" FROM "Audit" WHERE "startedAt" IS NOT NULL AND "finishedAt" IS NOT NULL`,
      this.queue.audits.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
      this.queue.reports.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
      this.queue.audits.getWorkers(),
    ]);
    return {
      users,
      projects,
      activeAudits,
      failedAudits,
      averageDurationMs: duration[0]?.averageMs ?? null,
      storage: {
        artifactBytes: artifacts._sum.sizeBytes ?? 0,
        artifacts: artifacts._count,
        completedExports: exports,
      },
      queues: { audits: auditQueue, reports: reportQueue },
      workers: { connected: workers.length, activeJobs: auditQueue.active ?? 0 },
      services: { postgres: 'up', redis: 'up' },
    };
  }
  @Get('users') async users(@Query() query: Record<string, unknown>) {
    const { page, pageSize, skip, take } = pageOptions(query);
    const search = parse(z.string().max(100).default(''), query.search);
    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [items, total] = await this.db.$transaction([
      this.db.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          blocked: true,
          emailVerifiedAt: true,
          createdAt: true,
          _count: { select: { projects: true } },
        },
      }),
      this.db.user.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
  @Patch('users/:id') async block(
    @Req() req: AuthRequest,
    @Param('id') userId: string,
    @Body() body: unknown,
  ) {
    id(userId);
    const { blocked } = parse(z.object({ blocked: z.boolean() }).strict(), body);
    if (userId === req.user.id)
      apiError(409, 'SELF_BLOCK_FORBIDDEN', 'You cannot block your own administrator account.');
    const user = await this.db.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const existing = await tx.user.findUnique({ where: { id: userId } });
      if (!existing) apiError(404, 'NOT_FOUND', 'The user was not found.');
      const updated = await tx.user.update({ where: { id: userId }, data: { blocked } });
      if (blocked) await tx.session.deleteMany({ where: { userId } });
      return updated;
    });
    return { user: { ...publicUser(user), blocked: user.blocked } };
  }
}
