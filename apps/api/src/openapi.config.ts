import { DocumentBuilder } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';

export const OPENAPI_VERSION = '1.0.0';

/**
 * The OpenAPI description, shared by the Swagger UI that main.ts serves and by
 * scripts/generate-openapi.ts, which writes docs/api/openapi.json. Keeping one
 * definition means the checked-in spec cannot drift from the running API.
 */
export function buildOpenApiConfig(serverUrl: string): Omit<OpenAPIObject, 'paths'> {
  return new DocumentBuilder()
    .setTitle('RIVO API')
    .setDescription(
      'RIVO | ريفو — خرائط | داركم.\n\n' +
        'Smart navigation and the Iraqi real-estate marketplace in one API.\n\n' +
        '**Business rules enforced server-side:** 8–18 property photos, minimum 1080p reels, ' +
        'a 3,000 IQD listing fee, and payment state that only a verified gateway webhook can advance.',
    )
    .setVersion(OPENAPI_VERSION)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'user')
    .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'admin')
    .addServer(serverUrl)
    .addTag('auth', 'Phone OTP sign-in, token rotation, device sessions')
    .addTag('properties', 'Darcom listings: create, search, moderate')
    .addTag('media', 'Photo upload to R2 and AI enhancement jobs')
    .addTag('reels', 'Property Reels: Cloudflare Stream upload and feed')
    .addTag('payments', '3,000 IQD listing fee and gateway webhooks')
    .addTag('maps', 'Search, traffic-aware routing, route feedback')
    .addTag('traffic', 'Road incidents and consented telemetry')
    .addTag('admin', 'Admin dashboard API (role-gated)')
    .build();
}
