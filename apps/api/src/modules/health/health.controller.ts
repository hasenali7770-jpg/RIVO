import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { EnvService } from '../../common/env/env.service';

/**
 * Health and capability endpoints — Master Plan §17.
 *
 * `/health` is the uptime-monitor target: cheap, unauthenticated, and it reports
 * degraded dependencies rather than lying about them.
 *
 * `/health/capabilities` tells the mobile app which integrations this deployment
 * actually has, so the UI can hide a control instead of showing a button that
 * would fail (Master Plan §24 — no dead controls).
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly env: EnvService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness and dependency health' })
  async health() {
    const [db, cache] = await Promise.all([this.checkDatabase(), this.redis.isHealthy()]);
    const healthy = db.ok && cache;
    return {
      status: healthy ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      version: process.env.npm_package_version ?? '1.0.0',
      environment: this.env.get('APP_ENV'),
      checks: {
        database: db.ok ? 'ok' : 'down',
        databaseLatencyMs: db.latencyMs,
        postgis: db.postgis ? 'ok' : 'missing',
        redis: cache ? 'ok' : 'down',
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('capabilities')
  @ApiOperation({
    summary: 'Which optional integrations are configured on this deployment',
    description:
      'The mobile app calls this at launch to decide which features to show. A false value means the credential is absent, not that the feature is broken.',
  })
  capabilities() {
    return {
      maps: this.env.hasMapbox,
      mapboxPublicToken: this.env.get('MAPBOX_PUBLIC_TOKEN') ?? null,
      mapStyles: {
        dark: this.env.get('MAPBOX_STYLE_DARK'),
        light: this.env.get('MAPBOX_STYLE_LIGHT'),
      },
      photoUploads: this.env.hasR2,
      reels: this.env.hasStream,
      aiEnhancement: this.env.hasAi,
      onlinePayments: this.env.hasOnlinePayments,
      paymentProvider: this.env.get('PAYMENT_PROVIDER'),
    };
  }

  private async checkDatabase(): Promise<{ ok: boolean; latencyMs: number; postgis: boolean }> {
    const started = Date.now();
    try {
      const rows = await this.prisma.$queryRaw<Array<{ postgis: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS postgis
      `;
      return { ok: true, latencyMs: Date.now() - started, postgis: rows[0]?.postgis ?? false };
    } catch {
      return { ok: false, latencyMs: Date.now() - started, postgis: false };
    }
  }
}
