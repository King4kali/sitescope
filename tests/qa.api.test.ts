import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/sitescope';
const { AccessGuard, hashToken } = await import('../apps/api/src/http.js');
const { AuditsService } = await import('../apps/api/src/audits.js');
const { ensureDeletable } = await import('../apps/api/src/projects.js');
const { webOrigin } = await import('../apps/api/src/config.js');

const userId = '48f8df84-758d-49b8-aaed-07136e509782';
const artifactId = 'd85887d0-8836-4580-81f0-999cdfc2c09c';
function request(options: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    path: '/api/v1/projects',
    ip: '172.20.0.5',
    socket: {},
    cookies: {},
    body: {},
    get: (header: string) =>
      ({ origin: webOrigin, 'x-requested-with': 'SiteScope', 'x-forwarded-for': '1.2.3.4' })[
        header
      ],
    ...options,
  };
}
function context(req: unknown) {
  return {
    getHandler: () => () => {},
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  };
}
function limiter() {
  const keys: string[] = [];
  const counts = new Map<string, number>();
  const redis = {
    client: {
      eval: async (_script: string, _number: number, key: string) => {
        keys.push(key);
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        return count;
      },
    },
  };
  const reflector = { getAllAndOverride: (name: string) => name === 'public' };
  const guard = new AccessGuard({} as never, redis as never, reflector as never);
  return { keys, counts, check: (req: unknown) => guard.canActivate(context(req) as never) };
}
function status(expected: number, code: string) {
  return (error: unknown) =>
    error instanceof HttpException &&
    error.getStatus() === expected &&
    (error.getResponse() as { code: string }).code === code;
}

test('QA: users behind the same frontend proxy have independent session rate windows', async () => {
  const limit = limiter();
  const first = 'a'.repeat(64);
  const second = 'b'.repeat(64);
  await limit.check(request({ cookies: { sitescope_session: first } }));
  await limit.check(request({ cookies: { sitescope_session: second } }));
  const firstKey = `ratelimit:session:${hashToken(first)}:api`;
  const secondKey = `ratelimit:session:${hashToken(second)}:api`;
  assert.ok(limit.keys.includes(firstKey));
  assert.ok(limit.keys.includes(secondKey));
  assert.equal(limit.counts.get(firstKey), 1);
  assert.equal(limit.counts.get(secondKey), 1);
  limit.counts.set(firstKey, 150);
  await assert.rejects(
    limit.check(request({ cookies: { sitescope_session: first } })),
    status(429, 'RATE_LIMITED'),
  );
  await limit.check(request({ cookies: { sitescope_session: second } }));
  assert.ok(limit.keys.every((key) => !key.includes(first) && !key.includes(second)));
});

test('QA: login windows use normalized account digests without sharing another account limit', async () => {
  const limit = limiter();
  const login = (email: string) =>
    request({ method: 'POST', path: '/api/v1/auth/login', body: { email } });
  await limit.check(login('  ALICE@Example.com  '));
  await limit.check(login('alice@example.com'));
  await limit.check(login('bob@example.com'));
  assert.equal(limit.counts.get(`ratelimit:account:${hashToken('alice@example.com')}:login`), 2);
  assert.equal(limit.counts.get(`ratelimit:account:${hashToken('bob@example.com')}:login`), 1);
  assert.ok(limit.keys.every((key) => !key.includes('@')));
});

test('QA: verification windows digest tokens and anonymous fallback retains a shared network ceiling', async () => {
  const limit = limiter();
  const token = 'c'.repeat(64);
  await limit.check(request({ method: 'POST', path: '/api/v1/auth/verify', body: { token } }));
  assert.ok(limit.keys.includes(`ratelimit:token:${hashToken(token)}:verify`));
  assert.ok(limit.keys.every((key) => !key.includes(token)));
  await limit.check(request());
  assert.ok(limit.keys.includes(`ratelimit:network:${hashToken('172.20.0.5')}:api`));
  limit.counts.set(`ratelimit:ceiling:${hashToken('172.20.0.5')}`, 3000);
  await assert.rejects(
    limit.check(request({ cookies: { sitescope_session: 'd'.repeat(64) } })),
    status(429, 'RATE_LIMITED'),
  );
});

test('QA: unavailable or expired artifacts fail before private object storage is read', async () => {
  const queries: unknown[] = [];
  let artifact: unknown = null;
  const db = {
    artifact: {
      findFirst: async (query: unknown) => {
        queries.push(query);
        return artifact;
      },
    },
  };
  const service = new AuditsService(db as never, {} as never);
  await assert.rejects(service.artifact(userId, artifactId, {} as never), status(404, 'NOT_FOUND'));
  artifact = {
    id: artifactId,
    storageKey: 'this-must-not-be-read',
    expiresAt: new Date(0),
    mimeType: 'image/png',
  };
  await assert.rejects(service.artifact(userId, artifactId, {} as never), status(404, 'NOT_FOUND'));
  assert.deepEqual(queries[0], {
    where: { id: artifactId, audit: { project: { ownerId: userId } } },
  });
});

test('QA: account deletion is rejected while a completed audit still has a running PDF export', async () => {
  let exportQuery: unknown;
  const tx = {
    audit: { count: async () => 0 },
    export: {
      count: async (query: unknown) => {
        exportQuery = query;
        return 1;
      },
    },
  };
  await assert.rejects(ensureDeletable(tx as never, userId), status(409, 'WORK_IN_PROGRESS'));
  assert.deepEqual(exportQuery, {
    where: { audit: { project: { ownerId: userId } }, status: { in: ['QUEUED', 'RUNNING'] } },
  });
});
