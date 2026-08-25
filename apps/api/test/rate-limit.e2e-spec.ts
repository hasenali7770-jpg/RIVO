import { INestApplication } from '@nestjs/common';

import { api, createTestApp } from './helpers';

/**
 * `@nestjs/throttler` applies every configured throttler to every route, so a
 * named budget declared for one endpoint silently becomes a global cap. With the
 * OTP budget at 6/hour that meant six anonymous listing searches from one IP
 * exhausted the API for an hour — and Iraqi mobile traffic shares a handful of
 * carrier NAT addresses.
 *
 * RivoThrottlerGuard enforces a named budget only where `@RateLimit` asked for
 * it. A skipped budget writes no headers, which is what these tests assert:
 * the numeric limits are raised in the test environment, so the headers are the
 * observable signal, not the 429.
 */
describe('rate-limit budgets are scoped to the routes that opt in', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  const namedHeaders = (headers: Record<string, unknown>): string[] =>
    Object.keys(headers).filter((h) => /^x-ratelimit-(limit|remaining|reset)-/i.test(h));

  it('charges an anonymous listing search to the default budget only', async () => {
    const res = await api(app).get('/api/v1/properties').expect(200);

    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(namedHeaders(res.headers)).toEqual([]);
  });

  it('does not charge public reads to the OTP budget', async () => {
    const res = await api(app).get('/api/v1/health').expect(200);

    expect(namedHeaders(res.headers)).not.toContain('x-ratelimit-remaining-otp');
  });

  it('charges the OTP budget on the route that declared it', async () => {
    const res = await api(app).post('/api/v1/auth/request-otp').send({ phone: '+9647700000111' });

    expect(namedHeaders(res.headers)).toContain('x-ratelimit-remaining-otp');
  });

  it('charges the admin-login budget on the admin login route only', async () => {
    const login = await api(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'nobody@rivo.local', password: 'not-the-password' });
    expect(namedHeaders(login.headers)).toContain('x-ratelimit-remaining-adminauth');

    const listing = await api(app).get('/api/v1/properties').expect(200);
    expect(namedHeaders(listing.headers)).not.toContain('x-ratelimit-remaining-adminauth');
  });

  it('answers a throttled caller in both languages with a plain Retry-After', async () => {
    // The e2e environment raises the numeric budgets, so drive the filter directly.
    const { AllExceptionsFilter } = await import('../src/common/filters/all-exceptions.filter');
    const { ThrottlerException } = await import('@nestjs/throttler');

    const headers: Record<string, unknown> = { 'retry-after-otp': 3600 };
    let status = 0;
    let payload: { error: { code: string; message: string; messageAr?: string } } | undefined;

    const response = {
      getHeader: (name: string) => headers[name.toLowerCase()],
      getHeaders: () => headers,
      setHeader: (name: string, value: unknown) => {
        headers[name.toLowerCase()] = value;
      },
      status: (code: number) => {
        status = code;
        return response;
      },
      json: (body: typeof payload) => {
        payload = body;
      },
    };

    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ method: 'POST', url: '/api/v1/auth/request-otp', originalUrl: '/api/v1/auth/request-otp' }),
      }),
    };

    new AllExceptionsFilter().catch(new ThrottlerException(), host as never);

    expect(status).toBe(429);
    expect(payload?.error.code).toBe('RATE_LIMITED');
    expect(payload?.error.message).not.toMatch(/ThrottlerException/);
    expect(payload?.error.messageAr).toBeTruthy();
    expect(headers['retry-after']).toBe(3600);
  });
});
