import { z } from 'zod';
import { SELLER_TYPES, SUPPORTED_LOCALES } from '@rivo/config';

export const requestOtpResponseSchema = z.object({
  challengeToken: z.string(),
  expiresInSeconds: z.number().int(),
  /** Present only in development (OTP_PROVIDER=console). Never in production. */
  devCode: z.string().optional(),
});
export type RequestOtpResponse = z.infer<typeof requestOtpResponseSchema>;

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
  tokenType: z.literal('Bearer'),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const authUserSchema = z.object({
  id: z.string().uuid(),
  phone: z.string(),
  displayName: z.string().nullable(),
  sellerType: z.enum(SELLER_TYPES),
  locale: z.enum(SUPPORTED_LOCALES),
  isNew: z.boolean(),
});

export const authResultSchema = tokenPairSchema.extend({ user: authUserSchema });
export type AuthResult = z.infer<typeof authResultSchema>;

export const sessionSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string(),
  ip: z.string().nullable(),
  device: z
    .object({ platform: z.string(), model: z.string().nullable(), appVersion: z.string().nullable() })
    .nullable(),
});
export type Session = z.infer<typeof sessionSchema>;
