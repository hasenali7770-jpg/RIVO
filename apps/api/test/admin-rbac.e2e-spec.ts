import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { hashSecret } from '../src/common/crypto/hash';
import { api, bearer, createTestApp, signIn } from './helpers';

/**
 * Admin authentication and RBAC — Master Plan §9 and §21
 * ("All admin operations require role permission").
 *
 * The first case here is a regression test. The global JwtAuthGuard used to run
 * ahead of AdminAuthGuard and reject every valid admin session token as a
 * malformed user JWT, making the whole dashboard unusable. Both guards now agree
 * on which routes belong to whom, and both still fail closed.
 */
describe('Admin RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const password = 'AdminTestPassword-2026';
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await prisma.truncateAllForTests();

    const roles = [
      { role: 'SUPER_ADMIN' as const, email: 'super@rivo.test' },
      { role: 'MODERATOR' as const, email: 'mod@rivo.test' },
      { role: 'FINANCE' as const, email: 'finance@rivo.test' },
      { role: 'SUPPORT' as const, email: 'support@rivo.test' },
    ];

    const passwordHash = await hashSecret(password);
    for (const { role, email } of roles) {
      await prisma.adminUser.create({
        data: { email, displayName: role, role, passwordHash, isActive: true },
      });
      const res = await api(app)
        .post('/api/v1/admin/auth/login')
        .send({ email, password })
        .expect(200);
      tokens[role] = res.body.token;
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('accepts an admin session token on an admin route', async () => {
    // The regression: this returned 401 because the user-JWT guard ran first.
    await api(app).get('/api/v1/admin/dashboard').set(bearer(tokens.SUPER_ADMIN)).expect(200);
  });

  it('refuses an admin route with no token', async () => {
    await api(app).get('/api/v1/admin/dashboard').expect(401);
  });

  it('refuses a malformed token', async () => {
    await api(app).get('/api/v1/admin/dashboard').set(bearer('not-a-real-token')).expect(401);
  });

  it('refuses an app-user JWT on an admin route', async () => {
    // An ordinary user must never reach the admin surface by reusing their token.
    const user = await signIn(app, '+9647705550001');
    await api(app).get('/api/v1/admin/dashboard').set(bearer(user.accessToken)).expect(401);
  });

  it('refuses an admin session token on a user route', async () => {
    // And the reverse: an admin token is not a user identity.
    await api(app).get('/api/v1/users/me').set(bearer(tokens.SUPER_ADMIN)).expect(401);
  });

  describe('role matrix', () => {
    const cases: Array<{ role: string; route: string; expected: number }> = [
      // Finance sees money and nothing else.
      { role: 'FINANCE', route: '/api/v1/admin/payments', expected: 200 },
      { role: 'FINANCE', route: '/api/v1/admin/properties', expected: 403 },
      { role: 'FINANCE', route: '/api/v1/admin/audit-logs', expected: 403 },
      { role: 'FINANCE', route: '/api/v1/admin/flags', expected: 403 },
      { role: 'FINANCE', route: '/api/v1/admin/admins', expected: 403 },

      // Moderators handle content, not money and not configuration.
      { role: 'MODERATOR', route: '/api/v1/admin/properties', expected: 200 },
      { role: 'MODERATOR', route: '/api/v1/admin/incidents', expected: 200 },
      { role: 'MODERATOR', route: '/api/v1/admin/payments', expected: 403 },
      { role: 'MODERATOR', route: '/api/v1/admin/flags', expected: 403 },
      { role: 'MODERATOR', route: '/api/v1/admin/admins', expected: 403 },

      // Support is read-only on content.
      { role: 'SUPPORT', route: '/api/v1/admin/properties', expected: 200 },
      { role: 'SUPPORT', route: '/api/v1/admin/users', expected: 200 },
      { role: 'SUPPORT', route: '/api/v1/admin/payments', expected: 403 },
      { role: 'SUPPORT', route: '/api/v1/admin/audit-logs', expected: 403 },

      // Super Admin passes every check by definition.
      { role: 'SUPER_ADMIN', route: '/api/v1/admin/payments', expected: 200 },
      { role: 'SUPER_ADMIN', route: '/api/v1/admin/flags', expected: 200 },
      { role: 'SUPER_ADMIN', route: '/api/v1/admin/audit-logs', expected: 200 },
      { role: 'SUPER_ADMIN', route: '/api/v1/admin/admins', expected: 200 },
    ];

    for (const { role, route, expected } of cases) {
      it(`${role} -> ${route} is ${expected}`, async () => {
        await api(app).get(route).set(bearer(tokens[role])).expect(expected);
      });
    }
  });

  describe('write actions', () => {
    it('does not let SUPPORT approve a listing', async () => {
      const user = await signIn(app, '+9647705550002');
      const property = await api(app)
        .post('/api/v1/properties')
        .set(bearer(user.accessToken))
        .send({
          type: 'HOUSE', purpose: 'SALE',
          title: 'دار للبيع في الكرادة قرب الشارع الرئيسي',
          description: 'وصف تجريبي كافٍ الطول لاجتياز التحقق من البيانات.',
          priceIqd: '100000000', areaSqm: 200, bedrooms: 3, bathrooms: 2,
          governorate: 'BAGHDAD', lat: 33.3018, lng: 44.4372,
        })
        .expect(201);

      await api(app)
        .post(`/api/v1/admin/properties/${property.body.id}/approve`)
        .set(bearer(tokens.SUPPORT))
        .send({})
        .expect(403);
    });

    it('does not let a MODERATOR settle a payment', async () => {
      await api(app)
        .post('/api/v1/admin/payments/00000000-0000-4000-8000-000000000000/settle')
        .set(bearer(tokens.MODERATOR))
        .send({ reference: 'TEST-123', note: 'attempting a settlement without permission' })
        .expect(403);
    });

    it('records an audit entry for every admin sign-in', async () => {
      const logs = await prisma.auditLog.findMany({ where: { action: 'admin.login' } });
      expect(logs.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('account protection', () => {
    it('locks an account after repeated failures', async () => {
      const email = 'lockme@rivo.test';
      await prisma.adminUser.create({
        data: { email, displayName: 'Lock', role: 'SUPPORT', passwordHash: await hashSecret(password) },
      });

      for (let i = 0; i < 5; i += 1) {
        await api(app).post('/api/v1/admin/auth/login').send({ email, password: 'wrong-password' }).expect(401);
      }

      // The correct password is now refused too: the lock is on the account, not
      // on the attempt, so rotating IPs does not help an attacker.
      const res = await api(app).post('/api/v1/admin/auth/login').send({ email, password });
      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('locked');
    });

    it('gives the same answer for an unknown address as for a wrong password', async () => {
      const unknown = await api(app)
        .post('/api/v1/admin/auth/login')
        .send({ email: 'nobody@rivo.test', password })
        .expect(401);
      const wrong = await api(app)
        .post('/api/v1/admin/auth/login')
        .send({ email: 'support@rivo.test', password: 'wrong-password' })
        .expect(401);

      // Identical messages, so the response does not reveal which addresses exist.
      expect(unknown.body.error.message).toBe(wrong.body.error.message);
    });
  });
});
