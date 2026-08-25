import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FEATURE_FLAG_DEFAULTS, FeatureFlagKey } from '@rivo/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { EnvService } from '../../common/env/env.service';
import { AppError } from '../../common/errors/app-error';

const CACHE_KEY = 'flags:all';
const CACHE_TTL_SECONDS = 30;

/**
 * Feature flags — Master Plan §9 module 12.
 *
 * A flag is only "on" when both the operator enabled it AND the deployment has
 * the credential the feature needs. That second condition is what keeps §24's
 * "no dead controls" rule true: turning on `reels_enabled` without a Cloudflare
 * Stream token does not put a broken button in front of a user.
 */
@Injectable()
export class FeatureFlagsService implements OnModuleInit {
  private readonly logger = new Logger(FeatureFlagsService.name);

  /** Flags whose feature cannot work without a specific credential. */
  private readonly credentialGates: Partial<Record<FeatureFlagKey, () => boolean>> = {};

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly env: EnvService,
  ) {
    this.credentialGates = {
      reels_enabled: () => this.env.hasStream,
      ai_photo_enhancement: () => this.env.hasAi,
      ai_video_enhancement: () => this.env.hasAi && this.env.hasStream,
      traffic_telemetry: () => true,
      voice_guidance: () => true,
      offline_maps: () => this.env.hasMapbox,
    };
  }

  /** Ensures every known flag has a row, so an admin can see and toggle it. */
  async onModuleInit(): Promise<void> {
    const entries = Object.entries(FEATURE_FLAG_DEFAULTS) as Array<[FeatureFlagKey, boolean]>;
    for (const [key, enabled] of entries) {
      await this.prisma.featureFlag.upsert({
        where: { key },
        create: { key, enabled, description: describe(key) },
        update: {},
      });
    }
    await this.invalidate();
    this.logger.log(`${entries.length} feature flags registered`);
  }

  async all(): Promise<Record<string, boolean>> {
    const cached = await this.redis.getJson<Record<string, boolean>>(CACHE_KEY);
    if (cached) return cached;

    const rows = await this.prisma.featureFlag.findMany();
    const resolved: Record<string, boolean> = { ...FEATURE_FLAG_DEFAULTS };
    for (const row of rows) resolved[row.key] = row.enabled;

    for (const [key, gate] of Object.entries(this.credentialGates)) {
      if (resolved[key] && gate && !gate()) resolved[key] = false;
    }

    await this.redis.setJson(CACHE_KEY, resolved, CACHE_TTL_SECONDS);
    return resolved;
  }

  async isEnabled(key: FeatureFlagKey): Promise<boolean> {
    const flags = await this.all();
    return flags[key] ?? FEATURE_FLAG_DEFAULTS[key] ?? false;
  }

  /** Throws a 503 naming the flag when the feature is off. */
  async assertEnabled(key: FeatureFlagKey): Promise<void> {
    if (!(await this.isEnabled(key))) throw AppError.featureDisabled(key);
  }

  /** Raw stored values plus whether a credential gate is currently blocking them. */
  async listForAdmin() {
    const rows = await this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
    return rows.map((row) => {
      const gate = this.credentialGates[row.key as FeatureFlagKey];
      const gateSatisfied = gate ? gate() : true;
      return {
        key: row.key,
        enabled: row.enabled,
        effective: row.enabled && gateSatisfied,
        blockedByMissingCredential: row.enabled && !gateSatisfied,
        description: row.description,
        config: row.config,
        updatedAt: row.updatedAt,
      };
    });
  }

  async set(key: string, enabled: boolean, adminId: string): Promise<void> {
    await this.prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled, description: describe(key), updatedByAdminId: adminId },
      update: { enabled, updatedByAdminId: adminId },
    });
    await this.invalidate();
  }

  async invalidate(): Promise<void> {
    await this.redis.client.del(CACHE_KEY);
  }
}

function describe(key: string): string {
  const descriptions: Record<string, string> = {
    reels_enabled: 'Darcom Reels feed and reel upload. Requires Cloudflare Stream credentials.',
    ai_photo_enhancement: 'AI photo enhancement pipeline. Requires an AI provider credential.',
    ai_video_enhancement: 'AI video cover selection and metadata suggestion.',
    voice_guidance: 'Turn-by-turn voice guidance in the mobile app.',
    traffic_telemetry: 'Anonymous traffic telemetry collection. Still requires per-user opt-in.',
    incident_confirmations: 'Community confirm/dismiss voting on road incidents.',
    approximate_location_option: 'Lets a seller publish an approximate rather than exact map pin.',
    featured_listings: 'Featured and pinned listings (post-MVP upsell).',
    agency_packages: 'Real-estate office subscription packages (post-MVP).',
    listing_analytics: 'Seller-facing view and contact analytics (post-MVP).',
    offline_maps: 'Downloadable offline map packs (Scale phase).',
  };
  return descriptions[key] ?? key;
}
