import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AUDIT_QUEUE, REPORT_QUEUE } from '@sitescope/core';
import { Database, RedisService } from './db.js';
import { config } from './config.js';
import { logger } from './http.js';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  readonly audits: Queue;
  readonly reports: Queue;
  private timer?: NodeJS.Timeout;
  private reconciling = false;
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(RedisService) redis: RedisService,
  ) {
    const options = {
      connection: redis.client,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 604800, count: 1000 },
      },
    };
    this.audits = new Queue(AUDIT_QUEUE, options);
    this.reports = new Queue(REPORT_QUEUE, options);
    this.audits.on('error', () =>
      logger.error({ code: 'AUDIT_QUEUE_UNAVAILABLE' }, 'Queue unavailable'),
    );
    this.reports.on('error', () =>
      logger.error({ code: 'REPORT_QUEUE_UNAVAILABLE' }, 'Queue unavailable'),
    );
  }
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.reconcile();
    }, 15000);
    this.timer.unref();
    void this.reconcile();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await Promise.all([this.audits.close(), this.reports.close()]);
  }
  async dispatch() {
    const events = await this.db.outboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    for (const event of events) {
      if (event.eventType === 'AUDIT_REQUESTED') {
        const record = await this.db.audit.findUnique({
          where: { id: event.aggregateId },
          select: { status: true },
        });
        if (record?.status === 'QUEUED')
          await this.audits.add(
            'audit',
            { auditId: event.aggregateId },
            { jobId: event.aggregateId },
          );
      } else if (event.eventType === 'EXPORT_REQUESTED') {
        const record = await this.db.export.findUnique({
          where: { id: event.aggregateId },
          select: { status: true },
        });
        if (record?.status === 'QUEUED')
          await this.reports.add(
            'report',
            { exportId: event.aggregateId },
            { jobId: event.aggregateId },
          );
      } else {
        logger.error(
          { code: 'UNKNOWN_OUTBOX_EVENT', eventId: event.id },
          'Outbox event has an unsupported type',
        );
        continue;
      }
      await this.db.outboxEvent.updateMany({
        where: { id: event.id, publishedAt: null },
        data: { publishedAt: new Date() },
      });
    }
  }
  async reconcile() {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      await this.dispatch();
      const staleBefore = new Date(Date.now() - config.AUDIT_TIMEOUT_MS - 120000);
      const records = await this.db.audit.findMany({
        where: {
          status: { in: ['QUEUED', 'RUNNING'] },
          createdAt: { lt: new Date(Date.now() - 30000) },
        },
        select: {
          id: true,
          status: true,
          startedAt: true,
          createdAt: true,
          results: { where: { module: 'http', status: 'COMPLETED' }, select: { id: true } },
        },
        take: 100,
      });
      for (const audit of records) {
        const job = await this.audits.getJob(audit.id);
        const state = job ? await job.getState() : 'missing';
        if (audit.status === 'QUEUED' && state === 'missing')
          await this.audits.add('audit', { auditId: audit.id }, { jobId: audit.id });
        else if (
          state === 'failed' ||
          state === 'completed' ||
          (audit.status === 'RUNNING' &&
            state === 'missing' &&
            (audit.startedAt ?? audit.createdAt) < staleBefore)
        ) {
          await this.db.$transaction(async (tx) => {
            const status = audit.results.length ? 'PARTIAL' : 'FAILED';
            const stage = status === 'PARTIAL' ? 'Partial' : 'Failed';
            const result = await tx.audit.updateMany({
              where: { id: audit.id, status: audit.status },
              data: { status, stage, finishedAt: new Date(), errorCode: 'WORKER_INTERRUPTED' },
            });
            if (result.count)
              await tx.auditEvent.create({
                data: {
                  auditId: audit.id,
                  eventType: status,
                  stage,
                  message:
                    'The worker stopped before completing this audit. Saved partial results remain available.',
                },
              });
          });
        }
        // Active jobs are never reset. BullMQ's lock and stalled-job recovery own their lifecycle.
      }
      const exports = await this.db.export.findMany({
        where: {
          status: { in: ['QUEUED', 'RUNNING'] },
          updatedAt: { lt: new Date(Date.now() - 120000) },
        },
        take: 100,
      });
      for (const record of exports) {
        const job = await this.reports.getJob(record.id);
        const state = job ? await job.getState() : 'missing';
        if (record.status === 'QUEUED' && state === 'missing')
          await this.reports.add('report', { exportId: record.id }, { jobId: record.id });
        else if (
          state === 'failed' ||
          state === 'completed' ||
          (record.status === 'RUNNING' && state === 'missing')
        )
          await this.db.export.updateMany({
            where: { id: record.id, status: record.status },
            data: { status: 'FAILED', errorCode: 'WORKER_INTERRUPTED' },
          });
      }
      await Promise.all([
        this.db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
        this.db.authToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
        this.db.outboxEvent.deleteMany({
          where: { publishedAt: { lt: new Date(Date.now() - 7 * 86400000) } },
        }),
      ]);
    } catch {
      logger.error({ code: 'QUEUE_RECONCILIATION_FAILED' }, 'Queue reconciliation will retry.');
    } finally {
      this.reconciling = false;
    }
  }
  kick() {
    void this.dispatch().catch(() =>
      logger.warn(
        { code: 'OUTBOX_PENDING' },
        'A committed job will be dispatched during reconciliation.',
      ),
    );
  }
}
