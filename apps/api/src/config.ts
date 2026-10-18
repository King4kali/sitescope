import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('SiteScope <noreply@sitescope.local>'),
  SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  MAX_PROJECTS: z.coerce.number().int().min(1).max(100).default(3),
  AUDITS_PER_DAY: z.coerce.number().int().min(1).max(1000).default(5),
  AUDIT_TIMEOUT_MS: z.coerce.number().int().min(30000).max(900000).default(240000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
});

export const config = configSchema.parse(process.env);
export const webOrigin = new URL(config.WEB_ORIGIN).origin;
export const SESSION_COOKIE = 'sitescope_session';
export const sessionCookieOptions = {
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: config.SESSION_DAYS * 86400000,
};
