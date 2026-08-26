/**
 * Runs the full maintenance sweep once and exits: telemetry aggregation, raw
 * telemetry purge, OTP and session cleanup, incident expiry.
 *
 * The worker runs these on a schedule. This entry point lets an operator force
 * a sweep and read the maintenance_runs rows it wrote.
 */
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from '../src/worker/worker.module';
import { MaintenanceProcessor } from '../src/worker/maintenance.processor';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error'] });
  try {
    const maintenance = app.get(MaintenanceProcessor);
    await maintenance.aggregateTelemetry();
    await maintenance.purgeRawTelemetry();
    await maintenance.expireIncidents();
    await maintenance.expirePayments();
    await maintenance.purgeOtpChallenges();
    await maintenance.purgeSessions();
    console.log('maintenance sweep complete');
  } finally {
    await app.close();
  }
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
