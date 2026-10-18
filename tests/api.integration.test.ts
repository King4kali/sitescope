import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';

/** Run against an isolated Compose stack: INTEGRATION_TESTS=1 npm test.
 * These exercise real HTTP, SMTP/Mailpit, PostgreSQL transactions, Redis and BullMQ.
 * The daily-limit fixture is persisted into the real test database, never mocked.
 */
test(
  'API integration: secure authentication, ownership, concurrency, quotas and transactional jobs',
  { skip: process.env.INTEGRATION_TESTS !== '1', timeout: 600000 },
  async () => {
    const api = process.env.API_URL || 'http://localhost:4000/api/v1';
    const origin = new URL(process.env.WEB_ORIGIN || 'http://localhost:3000').origin;
    const mailpit = process.env.MAILPIT_URL || 'http://localhost:8025';
    const db = new PrismaClient();
    const password = 'Integration passphrase 2048!';
    const changedPassword = 'Changed integration passphrase 2049!';
    const clients: { email: string; cookie: string; userId: string; password: string }[] = [];
    const auditIds: string[] = [];
    async function call(
      path: string,
      options: {
        method?: string;
        cookie?: string;
        body?: unknown;
        csrf?: boolean;
        headers?: Record<string, string>;
      } = {},
    ) {
      const response = await fetch(`${api}${path}`, {
        method: options.method || 'GET',
        headers: {
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(options.csrf === false ? {} : { Origin: origin, 'X-Requested-With': 'SiteScope' }),
          ...(options.cookie ? { Cookie: options.cookie } : {}),
          ...options.headers,
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(30000),
      });
      const value = (await response.json()) as any;
      return {
        status: response.status,
        value,
        cookie:
          response.headers
            .getSetCookie()
            .find((c) => c.startsWith('sitescope_session='))
            ?.split(';')[0] || '',
        requestId: response.headers.get('x-request-id'),
      };
    }
    async function emailToken(email: string, path: 'verify-email' | 'reset-password') {
      for (let attempt = 0; attempt < 15; attempt++) {
        const listing = (await fetch(`${mailpit}/api/v1/messages?limit=100`).then((r) =>
          r.json(),
        )) as { messages: { ID: string; To: { Address: string }[]; Subject: string }[] };
        const message = listing.messages.find(
          (m) =>
            m.To.some((to) => to.Address === email) &&
            m.Subject ===
              (path === 'verify-email'
                ? 'Verify your SiteScope email'
                : 'Reset your SiteScope password'),
        );
        if (message) {
          const content = (await fetch(
            `${mailpit}/api/v1/message/${encodeURIComponent(message.ID)}`,
          ).then((r) => r.json())) as { Text: string };
          const token = new RegExp(`${path}\\?token=([a-f0-9]{64})`).exec(content.Text)?.[1];
          if (token) return token;
        }
        await pause(1000);
      }
      assert.fail(`Verification/reset email was not delivered to Mailpit for ${email}`);
    }
    async function waitFinished(auditId: string, cookie: string) {
      for (let attempt = 0; attempt < 120; attempt++) {
        const result = await call(`/audits/${auditId}`, { cookie });
        if (result.status === 200 && !['QUEUED', 'RUNNING'].includes(result.value.status))
          return result.value;
        await pause(3000);
      }
      assert.fail('The real background audit did not reach a terminal state within six minutes.');
    }
    try {
      assert.equal((await call('/health/ready')).status, 200);
      assert.equal((await call('/projects')).status, 401);
      const crossSite = await call('/auth/login', {
        method: 'POST',
        csrf: false,
        body: { email: 'nobody@example.com', password },
      });
      assert.equal(crossSite.status, 403);
      assert.equal(crossSite.value.code, 'CSRF_REJECTED');
      assert.ok(crossSite.requestId);
      for (let index = 0; index < 2; index++) {
        const email = `integration-${randomUUID()}@example.com`;
        const registered = await call('/auth/register', {
          method: 'POST',
          body: { name: `Integration ${index}`, email, password },
        });
        assert.equal(registered.status, 201);
        assert.ok(registered.cookie);
        assert.equal(registered.value.user.emailVerifiedAt, null);
        assert.equal('passwordHash' in registered.value.user, false);
        const client = {
          email,
          cookie: registered.cookie,
          userId: registered.value.user.id as string,
          password,
        };
        clients.push(client);
        const stored = await db.session.findFirstOrThrow({ where: { userId: client.userId } });
        assert.equal(
          stored.tokenHash,
          createHash('sha256').update(client.cookie.split('=')[1]!).digest('hex'),
        );
        const token = await emailToken(email, 'verify-email');
        assert.equal((await call('/auth/verify', { method: 'POST', body: { token } })).status, 200);
        assert.equal((await call('/auth/verify', { method: 'POST', body: { token } })).status, 400);
        assert.ok((await call('/auth/me', { cookie: client.cookie })).value.user.emailVerifiedAt);
      }
      const owner = clients[0]!;
      const stranger = clients[1]!;
      const created = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          call('/projects', {
            method: 'POST',
            cookie: owner.cookie,
            body: { name: `Integration project ${i}`, url: 'https://example.com' },
          }),
        ),
      );
      assert.equal(created.filter((r) => r.status === 201).length, 3);
      assert.equal(
        created.filter((r) => r.status === 429 && r.value.code === 'PROJECT_LIMIT').length,
        1,
      );
      const project = created.find((r) => r.status === 201)!.value;
      assert.equal(
        (await call(`/projects/${project.id}`, { cookie: stranger.cookie })).status,
        404,
      );
      assert.equal(
        (
          await call(`/projects/${project.id}`, {
            method: 'PATCH',
            cookie: stranger.cookie,
            body: { name: 'Unauthorized edit' },
          })
        ).status,
        404,
      );
      assert.equal(
        (await call(`/projects/${project.id}`, { method: 'DELETE', cookie: stranger.cookie }))
          .status,
        404,
      );
      assert.equal((await call('/admin/stats', { cookie: owner.cookie })).status, 403);
      const unsafe = await call('/projects', {
        method: 'POST',
        cookie: stranger.cookie,
        body: { name: 'Unsafe', url: 'http://127.0.0.1' },
      });
      assert.equal(unsafe.status, 400);
      assert.equal(unsafe.value.code, 'UNSAFE_URL');
      const key = randomUUID();
      const starts = await Promise.all([
        call(`/projects/${project.id}/audits`, {
          method: 'POST',
          cookie: owner.cookie,
          body: {},
          headers: { 'Idempotency-Key': key },
        }),
        call(`/projects/${project.id}/audits`, {
          method: 'POST',
          cookie: owner.cookie,
          body: {},
          headers: { 'Idempotency-Key': randomUUID() },
        }),
      ]);
      assert.equal(starts.filter((r) => r.status === 202).length, 1);
      assert.equal(starts.filter((r) => r.status === 409).length, 1);
      const acceptedIndex = starts.findIndex((r) => r.status === 202);
      const auditId = starts[acceptedIndex]!.value.id as string;
      auditIds.push(auditId);
      if (acceptedIndex === 0) {
        const repeated = await call(`/projects/${project.id}/audits`, {
          method: 'POST',
          cookie: owner.cookie,
          body: {},
          headers: { 'Idempotency-Key': key },
        });
        assert.equal(repeated.status, 202);
        assert.equal(repeated.value.id, auditId);
      }
      assert.equal(await db.usageEvent.count({ where: { auditId } }), 1);
      assert.equal(
        await db.outboxEvent.count({
          where: { aggregateId: auditId, eventType: 'AUDIT_REQUESTED' },
        }),
        1,
      );
      assert.equal((await call(`/audits/${auditId}`, { cookie: stranger.cookie })).status, 404);
      assert.equal(
        (await call(`/audits/${auditId}/findings`, { cookie: stranger.cookie })).status,
        404,
      );
      assert.equal(
        (await call(`/audits/${auditId}/report`, { cookie: stranger.cookie })).status,
        404,
      );
      assert.equal(
        (
          await call(`/audits/${auditId}/exports`, {
            method: 'POST',
            cookie: stranger.cookie,
            body: {},
          })
        ).status,
        404,
      );
      const privateProject = await call('/projects', {
        method: 'POST',
        cookie: stranger.cookie,
        body: { name: 'Daily limit fixture', url: 'https://example.com' },
      });
      assert.equal(privateProject.status, 201);
      await db.usageEvent.createMany({
        data: Array.from({ length: 5 }, () => ({
          userId: stranger.userId,
          eventType: 'AUDIT_STARTED',
        })),
      });
      const limited = await call(`/projects/${privateProject.value.id}/audits`, {
        method: 'POST',
        cookie: stranger.cookie,
        body: {},
      });
      assert.equal(limited.status, 429);
      assert.equal(limited.value.code, 'DAILY_AUDIT_LIMIT');
      const forgotExisting = await call('/auth/forgot-password', {
        method: 'POST',
        body: { email: owner.email },
      });
      const forgotMissing = await call('/auth/forgot-password', {
        method: 'POST',
        body: { email: `missing-${randomUUID()}@example.com` },
      });
      assert.equal(forgotExisting.status, 200);
      assert.equal(forgotMissing.status, 200);
      assert.equal(forgotExisting.value.message, forgotMissing.value.message);
      const resetToken = await emailToken(owner.email, 'reset-password');
      assert.equal(
        (
          await call('/auth/reset-password', {
            method: 'POST',
            body: { token: resetToken, password: changedPassword },
          })
        ).status,
        200,
      );
      assert.equal((await call('/auth/me', { cookie: owner.cookie })).status, 401);
      const signedIn = await call('/auth/login', {
        method: 'POST',
        body: { email: owner.email, password: changedPassword },
      });
      assert.equal(signedIn.status, 200);
      owner.cookie = signedIn.cookie;
      owner.password = changedPassword;
      const result = await waitFinished(auditId, owner.cookie);
      assert.ok(
        ['COMPLETED', 'PARTIAL'].includes(result.status),
        `Audit must produce real results, received ${result.status}/${result.errorCode}`,
      );
      assert.ok(result.results.some((r: any) => r.module === 'http' && r.status === 'COMPLETED'));
      for (const device of ['mobile', 'desktop']) {
        const performance = result.results.find(
          (r: any) => r.module === 'performance' && r.device === device,
        );
        assert.equal(
          performance?.status,
          'COMPLETED',
          `Lighthouse ${device} failed: ${performance?.errorCode}`,
        );
        assert.equal(typeof performance.score, 'number');
        assert.ok(performance.score >= 0 && performance.score <= 100);
        assert.ok(
          Object.keys(performance.metricsJson).length > 0,
          'Lighthouse metrics must be persisted',
        );
        const screenshot = result.artifacts.find((a: any) => a.kind === `screenshot-${device}`);
        assert.ok(screenshot, `Missing ${device} screenshot`);
        const image = await fetch(`${api}/artifacts/${screenshot.id}`, {
          headers: { Cookie: owner.cookie },
        });
        assert.equal(image.status, 200);
        assert.match(image.headers.get('content-type') || '', /^image\/png/);
        const bytes = Buffer.from(await image.arrayBuffer());
        assert.ok(bytes.length > 1000);
        assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      }
      for (const artifact of result.artifacts as { id: string }[])
        assert.equal(
          (await call(`/artifacts/${artifact.id}`, { cookie: stranger.cookie })).status,
          404,
        );
      const exportCreated = await call(`/audits/${auditId}/exports`, {
        method: 'POST',
        cookie: owner.cookie,
        body: {},
      });
      assert.equal(exportCreated.status, 202);
      const exportId = exportCreated.value.id as string;
      assert.equal((await call(`/exports/${exportId}`, { cookie: stranger.cookie })).status, 404);
      assert.equal(
        (await call(`/exports/${exportId}/file`, { cookie: stranger.cookie })).status,
        404,
      );
      let readyExport: any;
      for (let attempt = 0; attempt < 60; attempt++) {
        const polled = await call(`/exports/${exportId}`, { cookie: owner.cookie });
        assert.equal(polled.status, 200);
        if (polled.value.status === 'FAILED')
          assert.fail(`Real PDF generation failed: ${polled.value.errorCode}`);
        if (polled.value.status === 'COMPLETED') {
          readyExport = polled.value;
          break;
        }
        await pause(2000);
      }
      assert.ok(readyExport?.url, 'Real PDF was not generated within two minutes.');
      const pdf = await fetch(new URL(readyExport.url, api), { headers: { Cookie: owner.cookie } });
      assert.equal(pdf.status, 200);
      assert.match(pdf.headers.get('content-type') || '', /^application\/pdf/);
      const pdfBytes = Buffer.from(await pdf.arrayBuffer());
      assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
      assert.ok(pdfBytes.length > 1000);
      for (const client of clients) {
        const deleted = await call('/users/me', {
          method: 'DELETE',
          cookie: client.cookie,
          body: { password: client.password },
        });
        assert.equal(deleted.status, 200);
        assert.equal(await db.user.count({ where: { id: client.userId } }), 0);
      }
    } finally {
      // Do not race a running worker during cleanup after a failed assertion.
      for (const auditId of auditIds) {
        const audit = await db.audit
          .findUnique({ where: { id: auditId }, select: { status: true } })
          .catch(() => null);
        if (audit && ['QUEUED', 'RUNNING'].includes(audit.status) && clients[0])
          await waitFinished(auditId, clients[0].cookie).catch(() => {});
      }
      for (const client of clients)
        await call('/users/me', {
          method: 'DELETE',
          cookie: client.cookie,
          body: { password: client.password },
        }).catch(() => {});
      await db.$disconnect();
    }
  },
);
