/**
 * Payment gateway contract — Master Plan §6 step 9 and §12.
 *
 * The rules this interface exists to guarantee:
 *  1. The amount is decided by the server. `createCheckout` receives it; it never
 *     reads an amount from a client request.
 *  2. Only `parseWebhook` can report a payment as paid, and only after
 *     `verifySignature` has returned true.
 *  3. No adapter may ever synthesise a successful payment. There is deliberately
 *     no "simulate success" method on this interface.
 */

export interface CreateCheckoutParams {
  /** Our idempotency key. The gateway must echo it back on the webhook. */
  merchantRef: string;
  amountIqd: number;
  currency: 'IQD';
  description: string;
  /** Where the gateway sends the user after payment. */
  returnUrl: string;
  /** Where the gateway POSTs the result. */
  webhookUrl: string;
  customerPhone?: string;
  propertyReference: string;
}

export interface CreateCheckoutResult {
  /** URL the app opens. Null for providers with no online checkout. */
  checkoutUrl: string | null;
  /** Gateway-side id, when the gateway assigns one at creation. */
  providerRef?: string;
  /** Human-readable next step when there is no checkout URL. */
  instructions?: string;
  instructionsAr?: string;
}

export type WebhookOutcome =
  | { kind: 'PAID'; merchantRef: string; providerRef: string; amountIqd: number; eventId?: string; eventType: string }
  | { kind: 'FAILED'; merchantRef: string; providerRef?: string; reason: string; eventId?: string; eventType: string }
  | { kind: 'CANCELLED'; merchantRef: string; providerRef?: string; eventId?: string; eventType: string }
  | { kind: 'REFUNDED'; merchantRef: string; providerRef?: string; eventId?: string; eventType: string }
  | { kind: 'IGNORED'; reason: string; eventType: string };

export interface PaymentProvider {
  readonly name: string;
  isConfigured(): boolean;

  /** Whether this provider drives the user through an online checkout. */
  readonly supportsOnlineCheckout: boolean;

  createCheckout(params: CreateCheckoutParams): Promise<CreateCheckoutResult>;

  /**
   * Verifies the webhook came from the gateway.
   * MUST use a constant-time comparison and MUST reject stale timestamps.
   */
  verifySignature(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean;

  /** Interprets a verified webhook body. Never called before verifySignature passes. */
  parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): WebhookOutcome;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
