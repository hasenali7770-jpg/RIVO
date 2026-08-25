import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import express from 'express';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { BigIntInterceptor } from '../src/common/interceptors/bigint.interceptor';
import { PrismaService } from '../src/common/prisma/prisma.service';

/** Builds the app with the same pipeline main.ts uses, so tests exercise the real stack. */
export async function createTestApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });

  app.use(
    express.json({
      verify: (req: express.Request & { rawBody?: string }, _res, buf: Buffer) => {
        if (buf?.length) req.rawBody = buf.toString('utf8');
      },
    }),
  );
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new BigIntInterceptor());

  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

export function api(app: INestApplication) {
  return request(app.getHttpServer());
}

/** Runs the full phone-OTP flow and returns a usable access token. */
export async function signIn(
  app: INestApplication,
  phone: string,
): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
  const otp = await api(app).post('/api/v1/auth/request-otp').send({ phone }).expect(200);
  const { challengeToken, devCode } = otp.body;

  const verify = await api(app)
    .post('/api/v1/auth/verify-otp')
    .send({ phone: otp.body.phone ?? phone, challengeToken, code: devCode })
    .expect(200);

  return {
    accessToken: verify.body.accessToken,
    refreshToken: verify.body.refreshToken,
    userId: verify.body.user.id,
  };
}

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Creates confirmed photo rows directly.
 *
 * The real path uploads to Cloudflare R2, which is not available in CI. What the
 * tests need to exercise is the server-side count rule, so the rows are written
 * as if the upload had been verified.
 */
export async function givePhotos(prisma: PrismaService, propertyId: string, count: number): Promise<void> {
  await prisma.propertyMedia.deleteMany({ where: { propertyId } });
  for (let i = 0; i < count; i += 1) {
    await prisma.propertyMedia.create({
      data: {
        propertyId,
        kind: 'ORIGINAL',
        objectKey: `test/${propertyId}/${i}.jpg`,
        bucket: 'rivo-test',
        mimeType: 'image/jpeg',
        sizeBytes: 500_000,
        width: 1920,
        height: 1440,
        position: i,
        uploadConfirmed: true,
        isSelected: true,
      },
    });
  }
}

export const VALID_PROPERTY = {
  type: 'HOUSE',
  purpose: 'SALE',
  title: 'دار للبيع في الكرادة قرب الشارع الرئيسي',
  description: 'دار مساحة 300 متر مع حديقة ومرآب سيارتين، قريبة من الخدمات والمدارس.',
  priceIqd: '250000000',
  areaSqm: 300,
  bedrooms: 4,
  bathrooms: 3,
  governorate: 'BAGHDAD',
  city: 'بغداد',
  district: 'الكرادة',
  lat: 33.3018,
  lng: 44.4372,
  contactPreference: 'BOTH',
};
