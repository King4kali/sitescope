import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { config } from './config.js';

@Injectable()
export class Database extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, connectTimeout: 5000 });
  constructor() {
    this.client.on('error', () => {
      /* Report availability through readiness without logging credentials. */
    });
  }
  async onModuleDestroy() {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
