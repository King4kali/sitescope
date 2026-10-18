import 'dotenv/config';
import { DelayedError, Worker } from 'bullmq';
import { AUDIT_QUEUE, REPORT_QUEUE, type AuditJob, type ReportJob } from '@sitescope/core';
import { db, errorCode, HostBusy, processAudit, processReport, redis } from './engine.js';

const connection = redis;
const auditWorker = new Worker<AuditJob>(
  AUDIT_QUEUE,
  async (job, token) => {
    try {
      await processAudit(job.data.auditId, job.attemptsMade + 1, job.opts.attempts ?? 1);
    } catch (failure) {
      if (failure instanceof HostBusy) {
        await job.moveToDelayed(Date.now() + 15_000, token);
        throw new DelayedError();
      }
      throw failure;
    }
  },
  {
    connection,
    concurrency: Math.min(4, Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 1)),
    lockDuration: 90_000,
    maxStalledCount: 2,
  },
);
const reportWorker = new Worker<ReportJob>(
  REPORT_QUEUE,
  (job) => processReport(job.data.exportId, job.attemptsMade + 1, job.opts.attempts ?? 1),
  { connection, concurrency: 1, lockDuration: 60_000, maxStalledCount: 2 },
);
for (const worker of [auditWorker, reportWorker]) {
  worker.on('error', (error) =>
    console.error(JSON.stringify({ service: 'worker', event: 'error', code: errorCode(error) })),
  );
  worker.on('completed', (job) =>
    console.log(
      JSON.stringify({ service: 'worker', event: 'completed', queue: worker.name, jobId: job.id }),
    ),
  );
}
auditWorker.on('failed', (job, error) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  void (async () => {
    const http = await db.auditResult.findUnique({
      where: {
        auditId_module_device: { auditId: job.data.auditId, module: 'http', device: 'all' },
      },
    });
    await db.audit.updateMany({
      where: { id: job.data.auditId, status: { in: ['RUNNING', 'QUEUED'] } },
      data: {
        status: http?.status === 'COMPLETED' ? 'PARTIAL' : 'FAILED',
        stage: http?.status === 'COMPLETED' ? 'Partial' : 'Failed',
        finishedAt: new Date(),
        errorCode: errorCode(error),
      },
    });
  })().catch(() => undefined);
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled([auditWorker.close(), reportWorker.close()]);
  await Promise.allSettled([db.$disconnect(), redis.quit()]);
}
process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
console.log(
  JSON.stringify({ service: 'worker', event: 'ready', queues: [AUDIT_QUEUE, REPORT_QUEUE] }),
);
