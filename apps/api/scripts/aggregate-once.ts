/**
 * Runs one telemetry aggregation pass and exits.
 *
 * The worker does this on a schedule; this entry point exists so an operator
 * (or an acceptance run) can force a pass and see the bucket count.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TrafficService } from '../src/modules/traffic/traffic.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const { buckets } = await app.get(TrafficService).aggregateTelemetry(new Date(Date.now() - 3600_000));
    console.log(`aggregated buckets: ${buckets}`);
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
