import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { TrafficService } from '../modules/traffic/traffic.service';
import { PaymentsService } from '../modules/payments/payments.service';

/**
 * Scheduled housekeeping.
 *
 * Each run is recorded in `maintenance_runs`, so an operator can see whether the
 * retention sweep actually ran — a privacy commitment nobody can verify is not
 * worth much.
 */
@Injectable()
export class MaintenanceProcessor {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly traffic: TrafficService,
    private readonly payments: PaymentsService,
  ) {}

  async aggregateTelemetry(): Promise<void> {
    await this.run('telemetry.aggregate', async () => {
      const { buckets } = await this.traffic.aggregateTelemetry();
      return { buckets };
    });
  }

  async purgeRawTelemetry(): Promise<void> {
    await this.run('telemetry.purge-raw', async () => {
      const deleted = await this.traffic.purgeRawTelemetry();
      return { deleted };
    });
  }

  async expireIncidents(): Promise<void> {
    await this.run('incidents.expire', async () => {
      const expired = await this.traffic.expireIncidents();
      return { expired };
    });
  }

  async expirePayments(): Promise<void> {
    await this.run('payments.expire', async () => {
      const expired = await this.payments.expireStaleIntents();
      return { expired };
    });
  }

  /** Clears OTP challenges that are spent or expired. */
  async purgeOtpChallenges(): Promise<void> {
    await this.run('otp.purge', async () => {
      const cutoff = new Date(Date.now() - 24 * 3600_000);
      const result = await this.prisma.otpChallenge.deleteMany({
        where: { OR: [{ expiresAt: { lt: cutoff } }, { consumedAt: { lt: cutoff } }] },
      });
      return { deleted: result.count };
    });
  }

  /** Clears refresh sessions that are long expired or revoked. */
  async purgeSessions(): Promise<void> {
    await this.run('sessions.purge', async () => {
      const cutoff = new Date(Date.now() - 30 * 24 * 3600_000);
      const [refresh, admin] = await Promise.all([
        this.prisma.refreshSession.deleteMany({
          where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
        }),
        this.prisma.adminSession.deleteMany({
          where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
        }),
      ]);
      return { refreshDeleted: refresh.count, adminDeleted: admin.count };
    });
  }

  private async run(job: string, fn: () => Promise<Record<string, unknown>>): Promise<void> {
    const record = await this.prisma.maintenanceRun.create({ data: { job, status: 'RUNNING' } });
    try {
      const details = await fn();
      await this.prisma.maintenanceRun.update({
        where: { id: record.id },
        data: { status: 'SUCCEEDED', details: details as object, finishedAt: new Date() },
      });
      this.logger.log(`${job}: ${JSON.stringify(details)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.maintenanceRun.update({
        where: { id: record.id },
        data: { status: 'FAILED', details: { error: message }, finishedAt: new Date() },
      });
      this.logger.error(`${job} failed: ${message}`);
    }
  }
}
