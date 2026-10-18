import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { verify as verifyPassword } from 'argon2';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/sitescope';
const { AccessGuard, hashToken, publicUser, utcDayStart } = await import('../apps/api/src/http.js');
const { AuthService } = await import('../apps/api/src/auth.js');
const { AuditsService } = await import('../apps/api/src/audits.js');
const { ensureOwnedAudit, ensureOwnedProject } = await import('../apps/api/src/projects.js');
const { webOrigin } = await import('../apps/api/src/config.js');

const userId = '48f8df84-758d-49b8-aaed-07136e509782';
const projectId = '4cff9554-bc2c-4840-a195-d44272b458c6';
const auditId = 'd85887d0-8836-4580-81f0-999cdfc2c09c';
const user = {
  id: userId,
  email: 'owner@example.com',
  name: 'Owner',
  role: 'USER',
  passwordHash: 'never-expose-this',
  blocked: false,
  emailVerifiedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};
function status(expected: number, code?: string) {
  return (error: unknown) =>
    error instanceof HttpException &&
    error.getStatus() === expected &&
    (!code || (error.getResponse() as { code: string }).code === code);
}
function request(overrides: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    path: '/api/v1/projects',
    ip: '203.0.113.2',
    socket: {},
    cookies: { sitescope_session: 'a'.repeat(64) },
    get: (name: string) => ({ origin: webOrigin, 'x-requested-with': 'SiteScope' })[name],
    ...overrides,
  };
}
function context(req: unknown) {
  return {
    getHandler: () => () => {},
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  };
}
function guard(
  session: unknown,
  opts: { public?: boolean; admin?: boolean; count?: number; redisFails?: boolean } = {},
) {
  let tokenHash: string | undefined;
  const db = {
    session: {
      findUnique: async (query: { where: { tokenHash: string } }) => {
        tokenHash = query.where.tokenHash;
        return session;
      },
    },
  };
  const redis = {
    client: {
      eval: async () => {
        if (opts.redisFails) throw new Error('offline');
        return opts.count ?? 1;
      },
    },
  };
  const reflector = {
    getAllAndOverride: (key: string) => (key === 'public' ? opts.public : opts.admin),
  };
  return {
    instance: new AccessGuard(db as never, redis as never, reflector as never),
    tokenHash: () => tokenHash,
  };
}

test('session cookie is hashed before lookup and the authenticated user is attached', async () => {
  const req = request() as ReturnType<typeof request> & { user?: unknown; sessionId?: string };
  const g = guard({
    id: 'session',
    user,
    expiresAt: new Date(Date.now() + 60000),
    revokedAt: null,
  });
  assert.equal(await g.instance.canActivate(context(req) as never), true);
  assert.equal(g.tokenHash(), hashToken('a'.repeat(64)));
  assert.notEqual(g.tokenHash(), 'a'.repeat(64));
  assert.equal(req.user, user);
  assert.equal(req.sessionId, 'session');
});

test('revoked, expired, missing and blocked sessions cannot access resources', async () => {
  for (const session of [
    null,
    { user, expiresAt: new Date(0) },
    { user, expiresAt: new Date(Date.now() + 60000), revokedAt: new Date() },
    { user: { ...user, blocked: true }, expiresAt: new Date(Date.now() + 60000) },
  ]) {
    await assert.rejects(
      guard(session).instance.canActivate(context(request()) as never),
      status(401, 'UNAUTHENTICATED'),
    );
  }
});

test('all writes including public login reject cross-site and missing CSRF headers', async () => {
  for (const headers of [
    { origin: 'https://attacker.example', 'x-requested-with': 'SiteScope' },
    { origin: webOrigin },
    {},
  ]) {
    const req = request({
      method: 'POST',
      path: '/api/v1/auth/login',
      get: (name: string) => (headers as Record<string, string>)[name],
    });
    await assert.rejects(
      guard(null, { public: true }).instance.canActivate(context(req) as never),
      status(403, 'CSRF_REJECTED'),
    );
  }
});

test('rate limiter rejects exhausted windows and fails closed without Redis', async () => {
  await assert.rejects(
    guard(null, { public: true, count: 151 }).instance.canActivate(context(request()) as never),
    status(429, 'RATE_LIMITED'),
  );
  await assert.rejects(
    guard(null, { public: true, redisFails: true }).instance.canActivate(
      context(request()) as never,
    ),
    status(503, 'RATE_LIMIT_UNAVAILABLE'),
  );
});

test('administrator routes reject an ordinary authenticated user', async () => {
  const g = guard({ user, expiresAt: new Date(Date.now() + 60000) }, { admin: true });
  await assert.rejects(
    g.instance.canActivate(context(request()) as never),
    status(403, 'FORBIDDEN'),
  );
});

test('project and audit lookup scope the query to the current owner', async () => {
  let projectQuery: unknown;
  let auditQuery: unknown;
  const db = {
    project: {
      findFirst: async (q: unknown) => {
        projectQuery = q;
        return null;
      },
    },
    audit: {
      findFirst: async (q: unknown) => {
        auditQuery = q;
        return null;
      },
    },
  };
  await assert.rejects(ensureOwnedProject(db as never, projectId, userId), status(404));
  await assert.rejects(ensureOwnedAudit(db as never, auditId, userId), status(404));
  assert.deepEqual(projectQuery, { where: { id: projectId, ownerId: userId } });
  assert.deepEqual(auditQuery, {
    where: { id: auditId, project: { ownerId: userId } },
    include: { project: true },
  });
});

test('PDF export checks ownership inside the same per-user transaction before queueing', async () => {
  const calls: string[] = [];
  const tx = {
    $executeRaw: async () => {
      calls.push('lock');
    },
    audit: { findFirst: async () => null },
    export: {
      create: async () => {
        calls.push('created');
      },
    },
  };
  const db = { $transaction: async (action: (tx: unknown) => Promise<unknown>) => action(tx) };
  const svc = new AuditsService(
    db as never,
    {
      kick: () => {
        calls.push('queued');
      },
    } as never,
  );
  await assert.rejects(svc.createExport(userId, auditId), status(404));
  assert.deepEqual(calls, ['lock']);
});

test('running audit cannot generate an incomplete PDF and repeated completed exports reuse one record', async () => {
  let auditStatus = 'RUNNING';
  const record = {
    id: auditId,
    auditId,
    status: 'COMPLETED',
    storageKey: 'private/report.pdf',
    errorCode: null,
  };
  let creates = 0;
  const tx = {
    $executeRaw: async () => {},
    audit: { findFirst: async () => ({ status: auditStatus }) },
    export: {
      findFirst: async () => record,
      create: async () => {
        creates++;
        return record;
      },
    },
  };
  const db = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    export: { findFirst: async () => record },
  };
  const svc = new AuditsService(db as never, { kick: () => {} } as never);
  await assert.rejects(svc.createExport(userId, auditId), status(409, 'AUDIT_IN_PROGRESS'));
  auditStatus = 'COMPLETED';
  const result = await svc.createExport(userId, auditId);
  assert.equal(creates, 0);
  assert.equal(result.url, `/api/v1/exports/${auditId}/file`);
  assert.equal('storageKey' in result, false);
});

test('registration persists Argon2id and only digests of session and verification tokens', async () => {
  const stored: Record<string, any> = {};
  const mail: Record<string, any> = {};
  const cookies: Record<string, any> = {};
  const tx = {
    user: {
      create: async ({ data }: { data: any }) => {
        stored.user = data;
        return { ...user, ...data, emailVerifiedAt: null };
      },
    },
    authToken: {
      create: async ({ data }: { data: any }) => {
        stored.token = data;
      },
    },
    session: {
      create: async ({ data }: { data: any }) => {
        stored.session = data;
      },
    },
  };
  const db = { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) };
  const svc = new AuthService(
    db as never,
    {
      sendToken: async (email: string, token: string, kind: string) =>
        Object.assign(mail, { email, token, kind }),
    } as never,
  );
  const result = await svc.register(
    { name: 'Alice', email: 'ALICE@Example.com', password: 'Strong passphrase 123!' },
    {
      cookie: (key: string, raw: string, options: unknown) =>
        Object.assign(cookies, { key, raw, options }),
    } as never,
  );
  assert.match(stored.user.passwordHash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(stored.user.passwordHash, 'Strong passphrase 123!'), true);
  assert.equal(stored.user.email, 'alice@example.com');
  assert.equal(stored.token.tokenHash, hashToken(mail.token));
  assert.notEqual(stored.token.tokenHash, mail.token);
  assert.equal(stored.session.tokenHash, hashToken(cookies.raw));
  assert.notEqual(stored.session.tokenHash, cookies.raw);
  assert.equal(cookies.options.httpOnly, true);
  assert.equal(cookies.options.sameSite, 'lax');
  assert.equal(JSON.stringify(result).includes(stored.user.passwordHash), false);
  assert.equal(JSON.stringify(result).includes(mail.token), false);
});

test('verification tokens are single-use and consumed in the update transaction', async () => {
  let consumed = false;
  let verified = false;
  const token = 'c'.repeat(64);
  const tx = {
    $executeRaw: async () => {},
    authToken: {
      findUnique: async () =>
        consumed
          ? null
          : { id: 'token', userId, kind: 'VERIFY', expiresAt: new Date(Date.now() + 60000) },
      deleteMany: async () => {
        if (consumed) return { count: 0 };
        consumed = true;
        return { count: 1 };
      },
    },
    user: {
      findUnique: async () => user,
      update: async () => {
        verified = true;
      },
    },
  };
  const db = { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) };
  const svc = new AuthService(db as never, {} as never);
  await svc.verifyEmail({ token });
  assert.equal(verified, true);
  await assert.rejects(svc.verifyEmail({ token }), status(400, 'INVALID_TOKEN'));
});

test('public user serialization excludes credential fields and day limits use UTC', () => {
  assert.equal('passwordHash' in publicUser(user), false);
  assert.equal(
    utcDayStart(new Date('2026-10-18T23:59:59-07:00')).toISOString(),
    '2026-10-19T00:00:00.000Z',
  );
});
