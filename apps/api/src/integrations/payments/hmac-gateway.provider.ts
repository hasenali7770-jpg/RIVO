import { Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { RivoEnv } from '../../common/env/env.schema';
import {
  CreateCheckoutParams,
  CreateCheckoutResult,
  PaymentProvider,
  WebhookOutcome,
} from './payment-provider.interface';

/**
 * Generic HMAC-signed payment gateway.
 *
 * Iraqi gateways (ZainCash, FastPay, Qi Card, and the bank-hosted processors)
 * share one shape: POST a signed order to a create endpoint, redirect the user,
 * then receive a signed server-to-server callback. This adapter implements that
 * shape against configuration so RIVO can go live once the merchant contract is
 * signed, without a rewrite.
 *
 * If the chosen gateway needs a different signing scheme — JWT-based like
 * ZainCash, or a bespoke field order — add a sibling adapter implementing
 * `PaymentProvider`. The interface is the contract; this class is one
 * implementation of it.
 *
 * IMPORTANT: this adapter never invents a gateway response. With no
 * PAYMENT_CREATE_URL configured it refuses to create a checkout rather than
 * returning a fake one.
 */
export class HmacGatewayProvider implements PaymentProvider {
  readonly name = 'hmac_gateway';
  readonly supportsOnlineCheckout = true;
  private readonly logger = new Logger('Payments:hmac_gateway');

  constructor(private readonly env: RivoEnv) {}

  isConfigured(): boolean {
    return Boolean(
      this.env.PAYMENT_MERCHANT_ID &&
        this.env.PAYMENT_SECRET &&
        this.env.PAYMENT_WEBHOOK_SECRET &&
        this.env.PAYMENT_CREATE_URL,
    );
  }

  async createCheckout(params: CreateCheckoutParams): Promise<CreateCheckoutResult> {
    if (!this.isConfigured()) {
      throw new Error(
        'Payment gateway is not configured: set PAYMENT_MERCHANT_ID, PAYMENT_SECRET, PAYMENT_WEBHOOK_SECRET and PAYMENT_CREATE_URL',
      );
    }

    const payload = {
      merchantId: this.env.PAYMENT_MERCHANT_ID,
      orderId: params.merchantRef,
      amount: params.amountIqd,
      currency: params.currency,
      description: params.description,
      returnUrl: params.returnUrl,
      callbackUrl: params.webhookUrl,
      customerPhone: params.customerPhone,
      reference: params.propertyReference,
      timestamp: Math.floor(Date.now() / 1000),
    };

    const body = JSON.stringify(payload);
    const signature = createHmac(this.env.PAYMENT_WEBHOOK_SIGNATURE_ALGO, this.env.PAYMENT_SECRET as string)
      .update(body)
      .digest('hex');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let response: Response;
    try {
      response = await fetch(this.env.PAYMENT_CREATE_URL as string, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [this.env.PAYMENT_WEBHOOK_SIGNATURE_HEADER]: signature,
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Gateway unreachable while creating order ${params.merchantRef}: ${reason}`);
      throw new Error(`Payment gateway is unreachable: ${reason}`);
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    if (!response.ok) {
      this.logger.error(`Gateway rejected order ${params.merchantRef}: HTTP ${response.status}`);
      throw new Error(`Payment gateway returned HTTP ${response.status}`);
    }

    let parsed: { checkoutUrl?: string; paymentUrl?: string; url?: string; transactionId?: string; id?: string };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new Error('Payment gateway returned a response that is not JSON');
    }

    const checkoutUrl = parsed.checkoutUrl ?? parsed.paymentUrl ?? parsed.url ?? null;
    if (!checkoutUrl) {
      // Better to fail here than to hand the app a null URL and let the user
      // reach a dead end.
      throw new Error('Payment gateway did not return a checkout URL');
    }

    return { checkoutUrl, providerRef: parsed.transactionId ?? parsed.id };
  }

  verifySignature(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean {
    const secret = this.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret) return false;

    const headerName = this.env.PAYMENT_WEBHOOK_SIGNATURE_HEADER.toLowerCase();
    const raw = headers[headerName];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (!provided) {
      this.logger.warn(`Webhook rejected: missing ${headerName} header`);
      return false;
    }

    // Accept both "abc123" and "sha256=abc123" / "t=...,v1=..." styles.
    const signature = extractSignature(provided);
    const timestamp = extractTimestamp(provided);

    if (timestamp !== null) {
      const age = Math.abs(Date.now() / 1000 - timestamp);
      if (age > this.env.PAYMENT_WEBHOOK_TOLERANCE_SECONDS) {
        this.logger.warn(`Webhook rejected: signature timestamp is ${Math.round(age)}s old (replay protection)`);
        return false;
      }
    }

    const signedPayload = timestamp !== null ? `${timestamp}.${rawBody}` : rawBody;
    const expected = createHmac(this.env.PAYMENT_WEBHOOK_SIGNATURE_ALGO, secret).update(signedPayload).digest('hex');

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature.toLowerCase(), 'utf8');
    if (a.length !== b.length) {
      this.logger.warn('Webhook rejected: signature length mismatch');
      return false;
    }
    const ok = timingSafeEqual(a, b);
    if (!ok) this.logger.warn('Webhook rejected: signature does not match');
    return ok;
  }

  parseWebhook(rawBody: string): WebhookOutcome {
    let body: {
      orderId?: string;
      merchantRef?: string;
      status?: string;
      state?: string;
      amount?: number | string;
      transactionId?: string;
      id?: string;
      eventId?: string;
      event?: string;
      type?: string;
      message?: string;
      reason?: string;
    };
    try {
      body = JSON.parse(rawBody) as typeof body;
    } catch {
      return { kind: 'IGNORED', reason: 'Webhook body is not valid JSON', eventType: 'unknown' };
    }

    const merchantRef = body.orderId ?? body.merchantRef;
    const eventType = body.event ?? body.type ?? body.status ?? body.state ?? 'unknown';
    const eventId = body.eventId ?? body.id;
    const providerRef = body.transactionId ?? body.id ?? '';

    if (!merchantRef) {
      return { kind: 'IGNORED', reason: 'Webhook did not identify an order', eventType };
    }

    const status = String(body.status ?? body.state ?? body.event ?? '').toUpperCase();

    if (['PAID', 'SUCCESS', 'SUCCEEDED', 'COMPLETED', 'CAPTURED', 'APPROVED'].includes(status)) {
      const amountIqd = Number(body.amount);
      if (!Number.isFinite(amountIqd)) {
        // A "paid" event with no readable amount cannot be trusted to settle a
        // listing fee: it is recorded and refused, not applied.
        return { kind: 'IGNORED', reason: 'Paid event carried no usable amount', eventType };
      }
      return { kind: 'PAID', merchantRef, providerRef, amountIqd: Math.round(amountIqd), eventId, eventType };
    }

    if (['FAILED', 'DECLINED', 'ERROR', 'REJECTED'].includes(status)) {
      return {
        kind: 'FAILED',
        merchantRef,
        providerRef,
        reason: body.message ?? body.reason ?? 'Payment was declined',
        eventId,
        eventType,
      };
    }

    if (['CANCELLED', 'CANCELED', 'EXPIRED', 'TIMEOUT'].includes(status)) {
      return { kind: 'CANCELLED', merchantRef, providerRef, eventId, eventType };
    }

    if (['REFUNDED', 'REVERSED', 'CHARGEBACK'].includes(status)) {
      return { kind: 'REFUNDED', merchantRef, providerRef, eventId, eventType };
    }

    return { kind: 'IGNORED', reason: `Unhandled gateway status "${status}"`, eventType };
  }
}

/** Pulls the hex digest out of `abc`, `sha256=abc`, or `t=123,v1=abc`. */
function extractSignature(header: string): string {
  if (header.includes('v1=')) {
    const match = /v1=([a-f0-9]+)/i.exec(header);
    if (match) return match[1];
  }
  if (header.includes('=')) {
    const parts = header.split('=');
    return parts[parts.length - 1].trim();
  }
  return header.trim();
}

/** Pulls the unix timestamp out of `t=123,v1=abc`, when present. */
function extractTimestamp(header: string): number | null {
  const match = /(?:^|,)\s*t=(\d+)/.exec(header);
  return match ? Number(match[1]) : null;
}
