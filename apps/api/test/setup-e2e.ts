/**
 * e2e test bootstrap.
 *
 * The suite runs against a REAL PostgreSQL+PostGIS and Redis, not mocks: the
 * rules under test (the 8-18 photo CHECK, PostGIS radius search, the append-only
 * audit trigger) live in the database, and a mocked client would prove nothing
 * about them.
 */
process.env.APP_ENV = 'test';
// Forced, not defaulted: a .env in the repo root would otherwise leave request
// logging on and bury the test output.
process.env.LOG_LEVEL = 'silent';
process.env.API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
process.env.ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3002';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? 'test-only-access-secret-not-used-anywhere-real-01';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? 'test-only-refresh-secret-not-used-anywhere-real-2';
process.env.OTP_PROVIDER = 'console';
process.env.PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER ?? 'manual';
process.env.AI_PROVIDER = 'none';
/**
 * The suite truncates every table, so it must never inherit DATABASE_URL: the
 * run instructions tell you to `source .env` before starting the API, and doing
 * that in the same shell would point the reset at your working database.
 * TEST_DATABASE_URL is the only way to redirect it, and PrismaService refuses
 * any database not named as a test database regardless.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5432/rivo_test?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

jest.setTimeout(60_000);

/**
 * The Redis-backed OTP counters in AuthService are shared across runs, so a
 * previous suite could otherwise leave a phone number rate-limited. Cleared here
 * rather than disabled, so the limits themselves stay real and testable.
 */
import Redis from 'ioredis';
beforeAll(async () => {
  const redis = new Redis(process.env.REDIS_URL as string);
  const keys = await redis.keys('otp:req:*');
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});
