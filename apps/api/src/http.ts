import { randomUUID, createHash } from 'node:crypto';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  CanActivate,
  ExecutionContext,
  SetMetadata,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma, type User } from '@prisma/client';
import type { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import { z } from 'zod';
import { Database, RedisService } from './db.js';
import { SESSION_COOKIE, webOrigin } from './config.js';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: ['password', 'token', 'cookie', 'authorization', 'passwordHash'],
});
export type AuthRequest = Request & { user: User; sessionId: string; requestId: string };
export const Public = () => SetMetadata('public', true);
export const Admin = () => SetMetadata('admin', true);
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function apiError(status: number, code: string, message: string, details?: unknown): never {
  throw new HttpException({ code, message, ...(details === undefined ? {} : { details }) }, status);
}
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    apiError(
      400,
      'VALIDATION_ERROR',
      'Please check the submitted information.',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  return result.data;
}
export const id = (input: string) => parse(z.string().uuid(), input);
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const pageOptions = (query: unknown) => {
  const p = parse(paginationSchema, query);
  return { ...p, skip: (p.page - 1) * p.pageSize, take: p.pageSize };
};
export const publicUser = (user: User) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  emailVerifiedAt: user.emailVerifiedAt,
  createdAt: user.createdAt,
});
export const utcDayStart = (date = new Date()) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
export async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
}

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const requestId = randomUUID();
  (req as AuthRequest).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  const started = Date.now();
  res.on('finish', () =>
    logger.info(
      {
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - started,
      },
      'request',
    ),
  );
  next();
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const req = context.getRequest<AuthRequest>();
    const res = context.getResponse<Response>();
    if (res.headersSent) return res.end();
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong. Please try again.';
    let details: unknown;
    if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      if (typeof body === 'object' && body) {
        const b = body as Record<string, unknown>;
        code = typeof b.code === 'string' ? b.code : `HTTP_${status}`;
        message = typeof b.message === 'string' ? b.message : error.message;
        details = b.details;
      } else message = String(body);
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        status = 409;
        code = 'CONFLICT';
        message = 'This record already exists.';
      } else if (error.code === 'P2025') {
        status = 404;
        code = 'NOT_FOUND';
        message = 'The requested resource was not found.';
      }
    } else if (error && typeof error === 'object' && 'type' in error) {
      const type = (error as { type: string }).type;
      if (type === 'entity.parse.failed') {
        status = 400;
        code = 'INVALID_JSON';
        message = 'The request body is not valid JSON.';
      } else if (type === 'entity.too.large') {
        status = 413;
        code = 'BODY_TOO_LARGE';
        message = 'The request body exceeds the 32 KB limit.';
      }
    }
    if (status >= 500)
      logger.error(
        {
          requestId: req.requestId,
          code,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'request failed',
      );
    res
      .status(status)
      .json({
        code,
        message,
        requestId: req.requestId || randomUUID(),
        ...(details === undefined ? {} : { details }),
      });
  }
}

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>('public', [
      context.getHandler(),
      context.getClass(),
    ]);
    const mutates = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (mutates && (req.get('origin') !== webOrigin || req.get('x-requested-with') !== 'SiteScope'))
      apiError(403, 'CSRF_REJECTED', 'This request must come from the SiteScope application.');
    if (!req.path.endsWith('/health/live') && !req.path.endsWith('/health/ready'))
      await this.limit(req);
    if (isPublic) return true;
    const raw = req.cookies?.[SESSION_COOKIE];
    if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw))
      apiError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    const session = await this.db.session.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.blocked)
      apiError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
    req.user = session.user;
    req.sessionId = session.id;
    if (
      this.reflector.getAllAndOverride<boolean>('admin', [
        context.getHandler(),
        context.getClass(),
      ]) &&
      req.user.role !== 'ADMIN'
    )
      apiError(403, 'FORBIDDEN', 'Administrator access is required.');
    return true;
  }
  private async limit(req: Request) {
    const authPath =
      /\/auth\/(login|register|forgot-password|reset-password|resend-verification|verify)$/.exec(
        req.path,
      )?.[1];
    const maximum = authPath ? (authPath === 'login' ? 15 : 8) : 150;
    const seconds = authPath ? 900 : 60;
    const network = hashToken(req.ip || req.socket.remoteAddress || 'unknown');
    // Next's trusted server-side proxy is shared by users. Account/session windows
    // must not collapse onto its IP, and caller-supplied forwarding headers are
    // never an authenticated client identity.
    const session = req.cookies?.[SESSION_COOKIE];
    const email =
      typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '';
    const token =
      typeof req.body?.token === 'string' && /^[a-f0-9]{64}$/.test(req.body.token)
        ? req.body.token
        : '';
    const identity =
      authPath && email
        ? `account:${hashToken(email)}`
        : typeof session === 'string' && /^[a-f0-9]{64}$/.test(session)
          ? `session:${hashToken(session)}`
          : authPath && token
            ? `token:${hashToken(token)}`
            : `network:${network}`;
    const key = `ratelimit:${identity}:${authPath || 'api'}`;
    try {
      // A generous shared ceiling still bounds random-account/token abuse.
      const networkCount = await this.redis.client.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n",
        1,
        `ratelimit:ceiling:${network}`,
        60,
      );
      if (Number(networkCount) > 3000)
        apiError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
      const result = await this.redis.client.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n",
        1,
        key,
        seconds,
      );
      if (Number(result) > maximum)
        apiError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({
        code: 'RATE_LIMIT_UNAVAILABLE',
        message: 'The service is temporarily unavailable. Please try again.',
      });
    }
  }
}
