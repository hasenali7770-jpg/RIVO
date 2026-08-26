import { z } from 'zod';

/** Every error the API returns uses this envelope. */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    messageAr: z.string().optional(),
    details: z.unknown().optional(),
    requestId: z.string(),
    timestamp: z.string(),
    path: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const paginationSchema = z.object({
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  hasMore: z.boolean().optional(),
});
export type Pagination = z.infer<typeof paginationSchema>;

/** Wraps any item schema in the standard paginated list shape. */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), pagination: paginationSchema });
}

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof latLngSchema>;

/**
 * Money is carried as a decimal string, never a JS number. Iraqi dinar amounts
 * routinely exceed 2^31, and a client parsing into a 32-bit int would silently
 * truncate a 250,000,000 IQD price.
 */
export const iqdAmountSchema = z.string().regex(/^\d+$/, 'must be a whole number of dinars');

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeSeconds: z.number(),
  version: z.string(),
  environment: z.string(),
  checks: z.object({
    database: z.string(),
    databaseLatencyMs: z.number(),
    postgis: z.string(),
    redis: z.string(),
  }),
  timestamp: z.string(),
});
export type Health = z.infer<typeof healthSchema>;

/**
 * Which optional integrations this deployment actually has. Clients must hide
 * any control whose capability is false rather than showing a button that would
 * fail (Master Plan §24).
 */
export const capabilitiesSchema = z.object({
  maps: z.boolean(),
  mapboxPublicToken: z.string().nullable(),
  mapStyles: z.object({ dark: z.string(), light: z.string() }),
  photoUploads: z.boolean(),
  reels: z.boolean(),
  aiEnhancement: z.boolean(),
  onlinePayments: z.boolean(),
  paymentProvider: z.string(),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;
