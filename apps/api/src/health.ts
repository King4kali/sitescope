import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Database, RedisService } from './db.js';
import { apiError, Public } from './http.js';

@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}
  @Get('live') live() {
    return { status: 'ok' };
  }
  @Get('ready') async ready() {
    const [database, redis] = await Promise.allSettled([
      this.db.$queryRaw`SELECT 1`,
      this.redis.client.ping(),
    ]);
    const services = {
      postgres: database.status === 'fulfilled' ? 'up' : 'down',
      redis: redis.status === 'fulfilled' ? 'up' : 'down',
    };
    if (Object.values(services).includes('down'))
      apiError(503, 'NOT_READY', 'One or more dependencies are unavailable.', services);
    return { status: 'ready', services };
  }
}
