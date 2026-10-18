import 'dotenv/config';
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory, APP_GUARD } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { config, webOrigin } from './config.js';
import { Database, RedisService } from './db.js';
import { AccessGuard, ApiExceptionFilter, logger, requestContext } from './http.js';
import { AuthController, AuthService } from './auth.js';
import { MailService } from './mail.js';
import { QueueService } from './queue.js';
import { ProjectsController, ProjectsService } from './projects.js';
import { AuditsController, AuditsService } from './audits.js';
import { UsersController, AdminController } from './users.js';
import { HealthController } from './health.js';

@Module({
  controllers: [
    AuthController,
    ProjectsController,
    AuditsController,
    UsersController,
    AdminController,
    HealthController,
  ],
  providers: [
    Database,
    RedisService,
    AuthService,
    MailService,
    QueueService,
    ProjectsService,
    AuditsService,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: ['error', 'warn', 'log'],
  });
  const server = app.getHttpAdapter().getInstance();
  server.set('trust proxy', config.TRUST_PROXY_HOPS || false);
  server.disable('x-powered-by');
  app.use(requestContext);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.enableCors({
    origin: webOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Requested-With', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id'],
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('SiteScope API')
      .setDescription(
        'Session-authenticated website audit API. Mutations require Origin matching WEB_ORIGIN and X-Requested-With: SiteScope. Limits reset at 00:00 UTC.',
      )
      .setVersion('1.0')
      .addCookieAuth('sitescope_session')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);
  await app.listen(config.PORT, '0.0.0.0');
  logger.info({ port: config.PORT }, 'SiteScope API listening');
}
if (process.env.NODE_ENV !== 'test')
  void bootstrap().catch((error: unknown) => {
    logger.fatal(
      { code: 'BOOT_FAILED', errorType: error instanceof Error ? error.name : 'UnknownError' },
      'API failed to start',
    );
    process.exitCode = 1;
  });
