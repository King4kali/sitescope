import { randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma, type User } from '@prisma/client';
import { hash, verify, argon2id } from 'argon2';
import type { Response } from 'express';
import { z } from 'zod';
import { Database } from './db.js';
import {
  apiError,
  type AuthRequest,
  hashToken,
  parse,
  Public,
  publicUser,
  lockUser,
} from './http.js';
import { config, SESSION_COOKIE, sessionCookieOptions } from './config.js';
import { MailService } from './mail.js';

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
export const passwordSchema = z.string().min(10, 'Use at least 10 characters.').max(128);
const registerSchema = z
  .object({ email: emailSchema, password: passwordSchema, name: z.string().trim().min(1).max(80) })
  .strict();
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict();
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/, 'This link is invalid or has expired.');
const hashPassword = (password: string) =>
  hash(password, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });

@Injectable()
export class AuthService {
  private readonly dummyHash = hashPassword(randomBytes(32).toString('hex'));
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(MailService) private readonly mail: MailService,
  ) {}
  async register(body: unknown, res: Response) {
    const input = parse(registerSchema, body);
    const passwordHash = await hashPassword(input.password);
    const token = randomBytes(32).toString('hex');
    const session = this.sessionData();
    let user: User;
    try {
      user = await this.db.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { email: input.email, name: input.name, passwordHash },
        });
        await tx.authToken.create({
          data: {
            userId: created.id,
            tokenHash: hashToken(token),
            kind: 'VERIFY',
            expiresAt: new Date(Date.now() + 86400000),
          },
        });
        await tx.session.create({ data: { userId: created.id, ...session.data } });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        apiError(409, 'EMAIL_UNAVAILABLE', 'An account with this email already exists.');
      throw error;
    }
    res.cookie(SESSION_COOKIE, session.raw, sessionCookieOptions);
    await this.mail.sendToken(user.email, token, 'VERIFY');
    return { user: publicUser(user) };
  }
  async login(body: unknown, res: Response) {
    const input = parse(loginSchema, body);
    const user = await this.db.user.findUnique({ where: { email: input.email } });
    const valid = await verify(user?.passwordHash ?? (await this.dummyHash), input.password).catch(
      () => false,
    );
    if (!user || !valid || user.blocked)
      apiError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
    const session = this.sessionData();
    await this.db.$transaction(async (tx) => {
      await lockUser(tx, user.id);
      const current = await tx.user.findUnique({ where: { id: user.id } });
      if (!current || current.blocked || current.passwordHash !== user.passwordHash)
        apiError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
      await tx.session.deleteMany({
        where: {
          userId: user.id,
          OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null } }],
        },
      });
      const oldSessions = await tx.session.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        skip: 9,
        select: { id: true },
      });
      if (oldSessions.length)
        await tx.session.deleteMany({ where: { id: { in: oldSessions.map((s) => s.id) } } });
      await tx.session.create({ data: { userId: user.id, ...session.data } });
    });
    res.cookie(SESSION_COOKIE, session.raw, sessionCookieOptions);
    return { user: publicUser(user) };
  }
  async logout(req: AuthRequest, res: Response) {
    await this.db.session.updateMany({
      where: { id: req.sessionId, userId: req.user.id },
      data: { revokedAt: new Date() },
    });
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions, maxAge: undefined });
    return { message: 'You have been signed out.' };
  }
  async verifyEmail(body: unknown) {
    const { token } = parse(z.object({ token: tokenSchema }).strict(), body);
    await this.consumeToken(token, 'VERIFY', async (tx, userId) => {
      await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    });
    return { message: 'Your email has been verified.' };
  }
  async resend(user: User) {
    if (user.emailVerifiedAt) return { message: 'Your email has already been verified.' };
    const raw = randomBytes(32).toString('hex');
    await this.db.$transaction(async (tx) => {
      await lockUser(tx, user.id);
      await tx.authToken.deleteMany({ where: { userId: user.id, kind: 'VERIFY' } });
      await tx.authToken.create({
        data: {
          userId: user.id,
          kind: 'VERIFY',
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
    });
    await this.mail.sendToken(user.email, raw, 'VERIFY');
    return { message: 'A verification link has been requested. Check your inbox.' };
  }
  async forgot(body: unknown) {
    const { email } = parse(z.object({ email: emailSchema }).strict(), body);
    const user = await this.db.user.findUnique({ where: { email } });
    if (user && !user.blocked) {
      const raw = randomBytes(32).toString('hex');
      await this.db.$transaction(async (tx) => {
        await lockUser(tx, user.id);
        await tx.authToken.deleteMany({ where: { userId: user.id, kind: 'RESET' } });
        await tx.authToken.create({
          data: {
            userId: user.id,
            kind: 'RESET',
            tokenHash: hashToken(raw),
            expiresAt: new Date(Date.now() + 3600000),
          },
        });
      });
      await this.mail.sendToken(user.email, raw, 'RESET');
    }
    return { message: 'If an account exists, a password reset link has been requested.' };
  }
  async reset(body: unknown, res: Response) {
    const { token, password } = parse(
      z.object({ token: tokenSchema, password: passwordSchema }).strict(),
      body,
    );
    const passwordHash = await hashPassword(password);
    await this.consumeToken(token, 'RESET', async (tx, userId) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId } });
      await tx.authToken.deleteMany({ where: { userId, kind: 'RESET' } });
    });
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions, maxAge: undefined });
    return { message: 'Your password has been reset. Please sign in.' };
  }
  private sessionData() {
    const raw = randomBytes(32).toString('hex');
    return {
      raw,
      data: {
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + config.SESSION_DAYS * 86400000),
      },
    };
  }
  private async consumeToken(
    raw: string,
    kind: string,
    action: (tx: Prisma.TransactionClient, userId: string) => Promise<void>,
  ) {
    await this.db.$transaction(async (tx) => {
      const found = await tx.authToken.findUnique({ where: { tokenHash: hashToken(raw) } });
      if (!found || found.kind !== kind || found.expiresAt <= new Date())
        apiError(400, 'INVALID_TOKEN', 'This link is invalid or has expired.');
      await lockUser(tx, found.userId);
      const user = await tx.user.findUnique({ where: { id: found.userId } });
      if (!user || user.blocked)
        apiError(400, 'INVALID_TOKEN', 'This link is invalid or has expired.');
      const consumed = await tx.authToken.deleteMany({
        where: { id: found.id, tokenHash: hashToken(raw), kind, expiresAt: { gt: new Date() } },
      });
      if (!consumed.count) apiError(400, 'INVALID_TOKEN', 'This link is invalid or has expired.');
      await action(tx, found.userId);
    });
  }
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Public() @Post('register') register(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.register(body, res);
  }
  @Public() @Post('login') @HttpCode(200) login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.login(body, res);
  }
  @Post('logout') @HttpCode(200) logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.logout(req, res);
  }
  @Get('me') me(@Req() req: AuthRequest) {
    return { user: publicUser(req.user) };
  }
  @Public() @Post('verify') @HttpCode(200) verify(@Body() body: unknown) {
    return this.auth.verifyEmail(body);
  }
  @Post('resend-verification') @HttpCode(200) resend(@Req() req: AuthRequest) {
    return this.auth.resend(req.user);
  }
  @Public() @Post('forgot-password') @HttpCode(200) forgot(@Body() body: unknown) {
    return this.auth.forgot(body);
  }
  @Public() @Post('reset-password') @HttpCode(200) reset(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.reset(body, res);
  }
}
