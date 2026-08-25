import { z } from 'zod';
import { LISTING_FEE_IQD, PAYMENT_STATUSES } from '@rivo/config';

export const paymentSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid(),
  /** Always the standard listing fee for a standard listing. */
  amountIqd: z.number().int(),
  currency: z.literal('IQD'),
  status: z.enum(PAYMENT_STATUSES),
  provider: z.string(),
  merchantRef: z.string(),
  /** Null when the configured provider has no online checkout. */
  checkoutUrl: z.string().nullable(),
  requiresOnlineCheckout: z.boolean(),
  failureReason: z.string().nullable(),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  /** Present when the provider settles offline; tells the user what to do next. */
  instructions: z.string().optional(),
  instructionsAr: z.string().optional(),
});
export type Payment = z.infer<typeof paymentSchema>;

export const STANDARD_LISTING_FEE_IQD = LISTING_FEE_IQD;

/**
 * The client polls this after returning from the gateway.
 *
 * A client must NEVER treat its own return screen as proof of payment: only the
 * status reported here, which is set by the verified webhook, is authoritative
 * (Master Plan §6 step 9).
 */
export const paymentStatusSchema = paymentSchema.extend({
  property: z.object({ id: z.string().uuid(), reference: z.string(), status: z.string() }),
  note: z.string(),
});
export type PaymentStatusResponse = z.infer<typeof paymentStatusSchema>;
