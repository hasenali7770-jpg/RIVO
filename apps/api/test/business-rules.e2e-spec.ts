import { INestApplication } from '@nestjs/common';
import {
  LISTING_FEE_IQD,
  PROPERTY_PHOTO_MAX,
  PROPERTY_PHOTO_MIN,
  REEL_MIN_SHORT_EDGE,
} from '@rivo/config';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { api, bearer, createTestApp, givePhotos, signIn, VALID_PROPERTY } from './helpers';

/**
 * The non-negotiable rules from Master Plan §21 and §24.
 *
 * These are the tests that must never be weakened: 8–18 photos, 1080p reels, a
 * 3,000 IQD fee, and a listing that cannot be published without a settled
 * payment or an admin approval.
 */
describe('RIVO business rules (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await prisma.truncateAllForTests();
    const session = await signIn(app, '+9647701110001');
    token = session.accessToken;
    userId = session.userId;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function newDraft(overrides: Record<string, unknown> = {}): Promise<string> {
    const res = await api(app)
      .post('/api/v1/properties')
      .set(bearer(token))
      .send({ ...VALID_PROPERTY, ...overrides })
      .expect(201);
    return res.body.id;
  }

  // -------------------------------------------------------------------------
  describe('photo count: 8 minimum, 18 maximum', () => {
    it('refuses submission with 7 photos', async () => {
      const id = await newDraft();
      await givePhotos(prisma, id, 7);

      const res = await api(app).post(`/api/v1/properties/${id}/submit`).set(bearer(token)).expect(422);
      expect(res.body.error.code).toBe('PHOTO_COUNT_TOO_LOW');
      expect(res.body.error.details.photoCount).toBe(7);
      expect(res.body.error.details.minimum).toBe(PROPERTY_PHOTO_MIN);
      // The seller must see an Arabic message, not just an English one.
      expect(res.body.error.messageAr).toBeTruthy();
    });

    it('accepts submission with exactly 8 photos', async () => {
      const id = await newDraft();
      await givePhotos(prisma, id, 8);

      const res = await api(app).post(`/api/v1/properties/${id}/submit`).set(bearer(token)).expect(200);
      expect(res.body.status).toBe('AWAITING_PAYMENT');
      expect(res.body.photoCount).toBe(8);
      expect(res.body.nextStep).toBe('PAYMENT');
    });

    it('accepts submission with exactly 18 photos', async () => {
      const id = await newDraft();
      await givePhotos(prisma, id, 18);

      const res = await api(app).post(`/api/v1/properties/${id}/submit`).set(bearer(token)).expect(200);
      expect(res.body.status).toBe('AWAITING_PAYMENT');
      expect(res.body.photoCount).toBe(18);
    });

    it('refuses submission with 19 photos', async () => {
      const id = await newDraft();
      await givePhotos(prisma, id, 19);

      const res = await api(app).post(`/api/v1/properties/${id}/submit`).set(bearer(token)).expect(422);
      expect(res.body.error.code).toBe('PHOTO_COUNT_TOO_HIGH');
      expect(res.body.error.details.maximum).toBe(PROPERTY_PHOTO_MAX);
    });

    it('keeps properties.photo_count in step with the media rows', async () => {
      const id = await newDraft();
      await givePhotos(prisma, id, 11);
      const row = await prisma.property.findUniqueOrThrow({ where: { id }, select: { photoCount: true } });
      // Maintained by a database trigger, so it cannot drift from reality.
      expect(row.photoCount).toBe(11);
    });

    it('refuses to publish outside 8-18 even at the database level', async () => {
      const id = await newDraft();
      await givePhotos(prisma, id, 3);
      // Bypasses the service entirely; the CHECK constraint is the last defence.
      await expect(
        prisma.property.update({ where: { id }, data: { status: 'PUBLISHED' } }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  describe('listing fee is exactly 3,000 IQD and server-decided', () => {
    it('creates the payment at the fixed amount', async () => {
      const id = await newDraft();
      await givePhotos(prisma, id, 8);
      await api(app).post(`/api/v1/properties/${id}/submit`).set(bearer(token)).expect(200);

      const res = await api(app)
        .post('/api/v1/payments/listing/create')
        .set(bearer(token))
        .send({ propertyId: id })
        .expect(201);

      expect(res.body.amountIqd).toBe(LISTING_FEE_IQD);
      expect(res.body.amountIqd).toBe(3000);
      expect(res.body.currency).toBe('IQD');
      expect(res.body.status).toBe('PENDING');
    });

    it('ignores any amount the client tries to send', async () => {
      const id = await newDraft();
      await givePhotos(prisma, id, 8);
      await api(app).post(`/api/v1/properties/${id}/submit`).set(bearer(token)).expect(200);

      // forbidNonWhitelisted rejects the unknown field outright rather than
      // silently dropping it.
      await api(app)
        .post('/api/v1/payments/listing/create')
        .set(bearer(token))
        .send({ propertyId: id, amountIqd: 1 })
        .expect(400);
    });

    it('refuses a payment for a listing that is not awaiting payment', async () => {
      const id = await newDraft();
      const res = await api(app)
        .post('/api/v1/payments/listing/create')
        .set(bearer(token))
        .send({ propertyId: id })
        .expect(409);
      expect(res.body.error.code).toBe('PROPERTY_INVALID_STATE');
    });
  });

  // -------------------------------------------------------------------------
  describe('the listing fee is charged once per listing', () => {
    it('sends a resubmitted listing straight back to review when its fee is settled', async () => {
      const id = await newDraft();
      await givePhotos(prisma, id, 8);
      await api(app).post(`/api/v1/properties/${id}/submit`).set(bearer(token)).expect(200);

      const payment = await api(app)
        .post('/api/v1/payments/listing/create')
        .set(bearer(token))
        .send({ propertyId: id })
        .expect(201);
      await prisma.listingPayment.update({
        where: { id: payment.body.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
      await prisma.property.update({ where: { id }, data: { status: 'REJECTED' } });

      await api(app).post(`/api/v1/properties/${id}/reopen`).set(bearer(token)).expect(200);
      const res = await api(app).post(`/api/v1/properties/${id}/submit`).set(bearer(token)).expect(200);

      // Sending it back to AWAITING_PAYMENT would strand it: creating a second
      // payment is refused with PAYMENT_ALREADY_PAID, so there would be no way
      // for the seller to get the fixed listing reviewed again.
      expect(res.body.status).toBe('PENDING_REVIEW');
      expect(res.body.nextStep).toBe('REVIEW');
    });

    it('still refuses a second payment for a listing that is already paid', async () => {
      const id = await newDraft();
      await givePhotos(prisma, id, 8);
      await api(app).post(`/api/v1/properties/${id}/submit`).set(bearer(token)).expect(200);

      const payment = await api(app)
        .post('/api/v1/payments/listing/create')
        .set(bearer(token))
        .send({ propertyId: id })
        .expect(201);
      await prisma.listingPayment.update({
        where: { id: payment.body.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
      await prisma.property.update({ where: { id }, data: { status: 'AWAITING_PAYMENT' } });

      const res = await api(app)
        .post('/api/v1/payments/listing/create')
        .set(bearer(token))
        .send({ propertyId: id })
        .expect(409);
      expect(res.body.error.code).toBe('PAYMENT_ALREADY_PAID');
    });

    it('still requires payment on a first submission', async () => {
      const id = await newDraft();
      await givePhotos(prisma, id, 8);
      const res = await api(app).post(`/api/v1/properties/${id}/submit`).set(bearer(token)).expect(200);

      expect(res.body.status).toBe('AWAITING_PAYMENT');
      expect(res.body.nextStep).toBe('PAYMENT');
    });
  });

  // -------------------------------------------------------------------------
  describe('an unpaid listing can never be published', () => {
    it('will not transition to PENDING_REVIEW without a settled payment', async () => {
      const id = await newDraft();
      await givePhotos(prisma, id, 8);
      await api(app).post(`/api/v1/properties/${id}/submit`).set(bearer(token)).expect(200);

      const row = await prisma.property.findUniqueOrThrow({ where: { id }, select: { status: true } });
      expect(row.status).toBe('AWAITING_PAYMENT');

      // There is no client-reachable route that advances this state; only a
      // verified webhook or an audited finance settlement can.
      const paid = await prisma.listingPayment.count({ where: { propertyId: id, status: 'PAID' } });
      expect(paid).toBe(0);
    });

    it('exposes no endpoint that lets a client mark its own payment paid', async () => {
      const id = await newDraft();
      await givePhotos(prisma, id, 8);
      await api(app).post(`/api/v1/properties/${id}/submit`).set(bearer(token)).expect(200);
      const payment = await api(app)
        .post('/api/v1/payments/listing/create')
        .set(bearer(token))
        .send({ propertyId: id })
        .expect(201);

      // The status route is read-only.
      await api(app).post(`/api/v1/payments/${payment.body.id}/status`).set(bearer(token)).expect(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('payment webhooks must be signed', () => {
    it('rejects an unsigned webhook and records it as evidence', async () => {
      const res = await api(app)
        .post('/api/v1/payments/webhook/manual')
        .send({ orderId: 'RIVO-FAKE', status: 'PAID', amount: 3000 })
        .expect(401);

      expect(res.body.error.code).toBe('PAYMENT_SIGNATURE_INVALID');

      const events = await prisma.paymentEvent.findMany({ where: { signatureValid: false } });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].rejectionReason).toContain('Signature');
    });

    it('rejects a webhook for an unknown provider', async () => {
      await api(app)
        .post('/api/v1/payments/webhook/not-a-real-gateway')
        .send({ orderId: 'x', status: 'PAID' })
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('reel resolution rule', () => {
    it('refuses to store a READY reel below 1080p at the database level', async () => {
      const id = await newDraft();
      const video = await prisma.propertyVideo.create({
        data: { propertyId: id, status: 'UPLOADED', streamUid: `test-${id}` },
      });

      // 1280x720 has a short edge of 720.
      await expect(
        prisma.propertyVideo.update({
          where: { id: video.id },
          data: { status: 'READY', width: 1280, height: 720, shortEdge: 720, durationSeconds: 30 },
        }),
      ).rejects.toThrow();
    });

    it('allows a READY reel at 1080x1920', async () => {
      const id = await newDraft();
      const video = await prisma.propertyVideo.create({
        data: { propertyId: id, status: 'UPLOADED', streamUid: `test2-${id}` },
      });

      const updated = await prisma.propertyVideo.update({
        where: { id: video.id },
        data: {
          status: 'READY',
          width: 1080,
          height: 1920,
          shortEdge: Math.min(1080, 1920),
          durationSeconds: 30,
          publishedAt: new Date(),
        },
      });
      expect(updated.status).toBe('READY');
      expect(updated.shortEdge).toBeGreaterThanOrEqual(REEL_MIN_SHORT_EDGE);
    });

    it('binds every reel to a property', async () => {
      // propertyId is NOT NULL with a foreign key, so an orphan reel cannot exist.
      await expect(
        prisma.propertyVideo.create({
          data: { propertyId: '00000000-0000-4000-8000-000000000000', status: 'PENDING_UPLOAD' },
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  describe('ownership isolation', () => {
    it('does not let one user submit another user’s listing', async () => {
      const id = await newDraft();
      await givePhotos(prisma, id, 8);

      const other = await signIn(app, '+9647701110002');
      // 404, not 403: confirming the listing exists would leak another user's draft.
      await api(app).post(`/api/v1/properties/${id}/submit`).set(bearer(other.accessToken)).expect(404);
    });

    it('does not expose an unpublished listing publicly', async () => {
      const id = await newDraft();
      await api(app).get(`/api/v1/properties/${id}`).expect(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('audit log is append-only', () => {
    it('refuses UPDATE and DELETE at the database level', async () => {
      await prisma.auditLog.create({ data: { action: 'test.action', entityType: 'property' } });
      await expect(
        prisma.auditLog.updateMany({ where: { action: 'test.action' }, data: { action: 'tampered' } }),
      ).rejects.toThrow();
      await expect(prisma.auditLog.deleteMany({ where: { action: 'test.action' } })).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  describe('user identity', () => {
    it('normalises Iraqi local phone formats to one account', async () => {
      const a = await signIn(app, '07701110003');
      const b = await signIn(app, '+9647701110003');
      expect(a.userId).toBe(b.userId);
    });

    it('created the signed-in user', async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.phoneVerified).toBe(true);
    });
  });
});
