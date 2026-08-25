import { INestApplication, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { EnvService } from '../env/env.service';

/**
 * Prisma client wired into the Nest lifecycle.
 *
 * Geospatial reads and writes do not go through the generated client — the
 * `geography` columns are `Unsupported` in the schema — so they use `$queryRaw`
 * via `GeoRepository`. Everything else uses the type-safe client.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const env = EnvService.instance;
    super({
      datasources: { db: { url: env.DATABASE_URL } },
      log:
        env.APP_ENV === 'development'
          ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
          : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();

    // A missing PostGIS extension is fatal: every map query depends on it, and
    // failing here gives a precise message instead of a confusing SQL error on
    // the first property search.
    const rows = await this.$queryRaw<Array<{ installed: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS installed
    `;
    if (!rows[0]?.installed) {
      throw new Error(
        'PostGIS is not installed in this database. Run `CREATE EXTENSION postgis;` as a superuser, or apply the RIVO migrations with a role permitted to create extensions.',
      );
    }
    this.logger.log('Database connected (PostGIS present)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Closes the pool cleanly when the process receives a shutdown signal. */
  async enableShutdownHooks(app: INestApplication): Promise<void> {
    process.on('beforeExit', () => {
      void app.close();
    });
  }

  /**
   * Deletes every row, in dependency order. Test-only: refuses to run outside
   * APP_ENV=test so it can never be reached by a production code path.
   */
  async truncateAllForTests(): Promise<void> {
    if (EnvService.instance.APP_ENV !== 'test') {
      throw new Error('truncateAllForTests() is only available when APP_ENV=test');
    }
    const tables = await this.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'
         AND tablename NOT IN ('spatial_ref_sys')
    `;
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    if (!list) return;
    // Triggers are disabled so the append-only guards on audit_logs do not block
    // the reset between test cases.
    await this.$executeRawUnsafe(`SET session_replication_role = 'replica'`);
    await this.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    await this.$executeRawUnsafe(`SET session_replication_role = 'origin'`);
  }
}

/** Narrow type for a transaction client, used by services that accept either. */
export type PrismaTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export { Prisma };
