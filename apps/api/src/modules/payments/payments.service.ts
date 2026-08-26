import { Inject, Injectable, Logger } from '@nestjs/common';
import { CURRENCY, LISTING_FEE_IQD } from '@rivo/config';
import type { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnvService } from '../../common/env/env.service';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { randomToken } from '../../common/crypto/hash';
import { PAYMENT_PROVIDER, PaymentProvider } from '../../integrations/payments/payment-provider.interface';
import { PropertiesService } from '../properties/properties.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly properties: PropertiesService,
    private readonly notifications: NotificationsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Creates a payment intent for a listing.
   *
   * The amount comes from LISTING_FEE_IQD, never from the request body — the
   * client has no way to influence what it is charged (Master Plan §6 step 9).
   */
  async createListingPayment(propertyId: string, userId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, ownerId: userId, deletedAt: null },
      select: { id: true, reference: true, status: true, title: true },
    });
    if (!property) throw AppError.notFound({ message: 'Listing not found' });

    if (property.status !== 'AWAITING_PAYMENT') {
      throw new AppError(409, {
        code: ErrorCode.PROPERTY_INVALID_STATE,
        message: `A payment can only be created for a listing in AWAITING_PAYMENT. This listing is ${property.status}.`,
        messageAr: 'لا يمكن إنشاء عملية دفع لهذا الإعلان في حالته الحالية.',
        details: { status: property.status },
      });
    }

    const alreadyPaid = await this.prisma.listingPayment.findFirst({
      where: { propertyId, status: 'PAID' },
    });
    if (alreadyPaid) {
      throw new AppError(409, {
        code: ErrorCode.PAYMENT_ALREADY_PAID,
        message: 'This listing has already been paid for',
        messageAr: 'تم دفع رسوم هذا الإعلان مسبقاً.',
        details: { paymentId: alreadyPaid.id },
      });
    }

    // Reuse an open intent rather than creating a duplicate order at the gateway
    // when the user taps "pay" twice.
    const openIntent = await this.prisma.listingPayment.findFirst({
      where: {
        propertyId,
        status: { in: ['PENDING', 'PROCESSING'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (openIntent) {
      return this.toPaymentResponse(openIntent);
    }

    const merchantRef = `RIVO-${property.reference}-${randomToken(8)}`;
    const expiresAt = new Date(Date.now() + this.env.get('PAYMENT_INTENT_TTL_MINUTES') * 60_000);

    const payment = await this.prisma.listingPayment.create({
      data: {
        propertyId,
        userId,
        amountIqd: LISTING_FEE_IQD,
        currency: CURRENCY,
        status: 'PENDING',
        provider: this.provider.name,
        merchantRef,
        expiresAt,
      },
    });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { phoneE164: true },
    });

    let checkoutUrl: string | null = null;
    let instructions: string | undefined;
    let instructionsAr: string | undefined;

    try {
      const checkout = await this.provider.createCheckout({
        merchantRef,
        amountIqd: LISTING_FEE_IQD,
        currency: 'IQD',
        description: `RIVO listing fee — ${property.reference}`,
        returnUrl: `${this.env.get('APP_DEEP_LINK_SCHEME')}://payment/return?ref=${merchantRef}`,
        webhookUrl: `${this.env.get('API_BASE_URL')}/api/v1/payments/webhook/${this.provider.name}`,
        customerPhone: user.phoneE164,
        propertyReference: property.reference,
      });
      checkoutUrl = checkout.checkoutUrl;
      instructions = checkout.instructions;
      instructionsAr = checkout.instructionsAr;

      await this.prisma.listingPayment.update({
        where: { id: payment.id },
        data: {
          checkoutUrl,
          providerRef: checkout.providerRef,
          status: checkout.checkoutUrl ? 'PROCESSING' : 'PENDING',
        },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Could not create checkout for ${merchantRef}: ${reason}`);
      await this.prisma.listingPayment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failureReason: reason },
      });
      throw new AppError(502, {
        code: ErrorCode.PAYMENT_PROVIDER_ERROR,
        message: `Payment gateway error: ${reason}`,
        messageAr: 'تعذّر بدء عملية الدفع. يرجى المحاولة لاحقاً.',
      });
    }

    const refreshed = await this.prisma.listingPayment.findUniqueOrThrow({ where: { id: payment.id } });
    return { ...this.toPaymentResponse(refreshed), instructions, instructionsAr };
  }

  async getStatus(paymentId: string, userId: string) {
    const payment = await this.prisma.listingPayment.findFirst({
      where: { id: paymentId, userId },
      include: { property: { select: { id: true, reference: true, status: true } } },
    });
    if (!payment) throw AppError.notFound({ message: 'Payment not found' });

    return {
      ...this.toPaymentResponse(payment),
      property: { id: payment.property.id, reference: payment.property.reference, status: payment.property.status },
      // Stated explicitly so a client author is never tempted to treat a
      // local success screen as authoritative.
      note: 'Payment state is set by the gateway webhook. A client-side success screen never marks a listing paid.',
    };
  }

  async listMine(userId: string, page = 1, limit = 20) {
    const [items, total] = await Promise.all([
      this.prisma.listingPayment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { property: { select: { reference: true, title: true } } },
      }),
      this.prisma.listingPayment.count({ where: { userId } }),
    ]);
    return {
      items: items.map((p) => ({
        ...this.toPaymentResponse(p),
        property: { reference: p.property.reference, title: p.property.title },
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Handles a gateway webhook.
   *
   * Order of operations, and why:
   *  1. Verify the signature FIRST. An unverified body is recorded as evidence
   *     and then rejected; it never reaches the state machine.
   *  2. Deduplicate on the provider event id, so a gateway retry cannot publish
   *     a listing twice or double-count revenue.
   *  3. Cross-check the amount against LISTING_FEE_IQD. A "paid" event for the
   *     wrong amount is refused rather than accepted.
   */
  async handleWebhook(params: {
    providerName: string;
    rawBody: string;
    headers: Record<string, string | string[] | undefined>;
    sourceIp: string | null;
  }): Promise<{ received: true; applied: boolean; reason?: string }> {
    const { providerName, rawBody, headers, sourceIp } = params;

    if (providerName !== this.provider.name) {
      await this.recordEvent({
        provider: providerName,
        eventType: 'unknown',
        signatureValid: false,
        rejectionReason: `No provider named "${providerName}" is configured`,
        rawBody,
        headers,
        sourceIp,
      });
      throw AppError.notFound({ message: `Unknown payment provider "${providerName}"` });
    }

    const signatureValid = this.provider.verifySignature(rawBody, headers);

    if (!signatureValid) {
      await this.recordEvent({
        provider: providerName,
        eventType: 'unverified',
        signatureValid: false,
        rejectionReason: 'Signature verification failed',
        rawBody,
        headers,
        sourceIp,
      });
      this.logger.warn(`Rejected an unsigned or badly signed ${providerName} webhook from ${sourceIp ?? 'unknown IP'}`);
      throw new AppError(401, {
        code: ErrorCode.PAYMENT_SIGNATURE_INVALID,
        message: 'Webhook signature verification failed',
      });
    }

    const outcome = this.provider.parseWebhook(rawBody, headers);

    if (outcome.kind === 'IGNORED') {
      await this.recordEvent({
        provider: providerName,
        eventType: outcome.eventType,
        signatureValid: true,
        rejectionReason: outcome.reason,
        rawBody,
        headers,
        sourceIp,
      });
      return { received: true, applied: false, reason: outcome.reason };
    }

    const payment = await this.prisma.listingPayment.findUnique({
      where: { merchantRef: outcome.merchantRef },
      include: { property: { select: { id: true, status: true, reference: true } } },
    });

    if (!payment) {
      await this.recordEvent({
        provider: providerName,
        eventType: outcome.eventType,
        providerEventId: outcome.eventId,
        signatureValid: true,
        rejectionReason: `No payment matches merchantRef ${outcome.merchantRef}`,
        rawBody,
        headers,
        sourceIp,
      });
      return { received: true, applied: false, reason: 'Unknown order reference' };
    }

    // Idempotency: a repeat of an event we already applied is acknowledged, not
    // re-applied.
    if (outcome.eventId) {
      const seen = await this.prisma.paymentEvent.findFirst({
        where: { provider: providerName, providerEventId: outcome.eventId, processedAt: { not: null } },
      });
      if (seen) {
        this.logger.log(`Ignoring duplicate ${providerName} event ${outcome.eventId}`);
        return { received: true, applied: false, reason: 'Duplicate event' };
      }
    }

    const event = await this.recordEvent({
      provider: providerName,
      eventType: outcome.eventType,
      providerEventId: outcome.eventId,
      signatureValid: true,
      rawBody,
      headers,
      sourceIp,
      paymentId: payment.id,
    });

    let applied = false;
    let reason: string | undefined;

    switch (outcome.kind) {
      case 'PAID': {
        if (outcome.amountIqd !== payment.amountIqd) {
          reason = `Amount mismatch: gateway reported ${outcome.amountIqd} IQD, order is ${payment.amountIqd} IQD`;
          this.logger.error(`REFUSED payment ${payment.id}: ${reason}`);
          await this.prisma.paymentEvent.update({
            where: { id: event.id },
            data: { rejectionReason: reason, processedAt: new Date() },
          });
          break;
        }
        if (payment.status === 'PAID') {
          reason = 'Payment was already marked paid';
          break;
        }
        await this.markPaid(payment.id, outcome.providerRef, payment.propertyId, payment.property.status);
        applied = true;
        break;
      }
      case 'FAILED': {
        await this.prisma.listingPayment.update({
          where: { id: payment.id },
          data: { status: 'FAILED', failureReason: outcome.reason, providerRef: outcome.providerRef ?? payment.providerRef },
        });
        await this.notifications.notify(payment.userId, {
          type: 'PAYMENT_FAILED',
          titleAr: 'فشل الدفع',
          titleEn: 'Payment failed',
          bodyAr: `تعذّر إتمام دفع رسوم إعلان ${payment.property.reference}. يرجى المحاولة مرة أخرى.`,
          bodyEn: `The listing fee for ${payment.property.reference} could not be collected. Please try again.`,
          deepLink: `rivo://property/${payment.propertyId}/payment`,
        });
        applied = true;
        break;
      }
      case 'CANCELLED': {
        await this.prisma.listingPayment.update({
          where: { id: payment.id },
          data: { status: 'CANCELLED', providerRef: outcome.providerRef ?? payment.providerRef },
        });
        applied = true;
        break;
      }
      case 'REFUNDED': {
        await this.prisma.listingPayment.update({
          where: { id: payment.id },
          data: { status: 'REFUNDED', refundedAt: new Date() },
        });
        // A refund does not silently unpublish: an operator decides, so a
        // legitimate refund-and-repost is not disrupted.
        this.logger.warn(
          `Payment ${payment.id} for listing ${payment.property.reference} was refunded; listing status left at ${payment.property.status} for operator review`,
        );
        applied = true;
        break;
      }
    }

    await this.prisma.paymentEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), ...(reason ? { rejectionReason: reason } : {}) },
    });

    return { received: true, applied, reason };
  }

  /**
   * The single place a payment becomes PAID and a listing enters moderation.
   * Called by the verified webhook path and by an audited admin settlement.
   */
  async markPaid(
    paymentId: string,
    providerRef: string | null,
    propertyId: string,
    propertyStatus: string,
    settledByAdminId?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.listingPayment.update({
        where: { id: paymentId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          providerRef: providerRef ?? undefined,
          failureReason: null,
          ...(settledByAdminId ? { settledByAdminId } : {}),
        },
      });
    });

    if (propertyStatus === 'AWAITING_PAYMENT') {
      await this.properties.applyTransition(
        propertyId,
        'AWAITING_PAYMENT',
        'paymentSettled',
        settledByAdminId ? 'ADMIN' : 'PAYMENT_WEBHOOK',
        settledByAdminId ?? null,
        settledByAdminId ? 'Payment settled by finance operator' : 'Payment confirmed by gateway webhook',
      );
    } else {
      this.logger.warn(
        `Payment ${paymentId} settled but listing ${propertyId} is ${propertyStatus}, not AWAITING_PAYMENT; status left unchanged`,
      );
    }

    const payment = await this.prisma.listingPayment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { property: { select: { reference: true } } },
    });

    await this.notifications.notify(payment.userId, {
      type: 'PAYMENT_PAID',
      titleAr: 'تم استلام الدفع',
      titleEn: 'Payment received',
      bodyAr: `تم استلام رسوم النشر لإعلان ${payment.property.reference}. الإعلان الآن قيد المراجعة.`,
      bodyEn: `The listing fee for ${payment.property.reference} was received. Your listing is now under review.`,
      deepLink: `rivo://property/${propertyId}`,
    });
  }

  /** Expires stale intents. Run by the maintenance queue. */
  async expireStaleIntents(): Promise<number> {
    const stale = await this.prisma.listingPayment.findMany({
      where: { status: { in: ['PENDING', 'PROCESSING'] }, expiresAt: { lt: new Date() } },
      select: { id: true, propertyId: true, property: { select: { status: true } } },
    });

    for (const payment of stale) {
      await this.prisma.listingPayment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });
      // The listing goes back to DRAFT so the seller can edit and retry rather
      // than being stuck in AWAITING_PAYMENT with a dead intent.
      if (payment.property.status === 'AWAITING_PAYMENT') {
        await this.properties
          .applyTransition(payment.propertyId, 'AWAITING_PAYMENT', 'expirePayment', 'SYSTEM', null, 'Payment window expired')
          .catch((err) => this.logger.warn(`Could not revert listing ${payment.propertyId}: ${err.message}`));
      }
    }
    return stale.length;
  }

  private async recordEvent(params: {
    provider: string;
    eventType: string;
    providerEventId?: string;
    signatureValid: boolean;
    rejectionReason?: string;
    rawBody: string;
    headers: Record<string, string | string[] | undefined>;
    sourceIp: string | null;
    paymentId?: string;
  }) {
    let payload: unknown;
    try {
      payload = JSON.parse(params.rawBody);
    } catch {
      payload = { raw: params.rawBody.slice(0, 4000) };
    }

    return this.prisma.paymentEvent.create({
      data: {
        paymentId: params.paymentId ?? null,
        provider: params.provider,
        eventType: params.eventType,
        providerEventId: params.providerEventId ?? null,
        signatureValid: params.signatureValid,
        rejectionReason: params.rejectionReason ?? null,
        payload: payload as object,
        headers: redactHeaders(params.headers) as object,
        sourceIp: params.sourceIp,
      },
    });
  }

  private toPaymentResponse(payment: {
    id: string;
    propertyId: string;
    amountIqd: number;
    currency: string;
    status: PaymentStatus;
    provider: string;
    merchantRef: string;
    checkoutUrl: string | null;
    failureReason: string | null;
    createdAt: Date;
    paidAt: Date | null;
    expiresAt: Date | null;
  }) {
    return {
      id: payment.id,
      propertyId: payment.propertyId,
      amountIqd: payment.amountIqd,
      currency: payment.currency,
      status: payment.status,
      provider: payment.provider,
      merchantRef: payment.merchantRef,
      checkoutUrl: payment.checkoutUrl,
      requiresOnlineCheckout: this.provider.supportsOnlineCheckout,
      failureReason: payment.failureReason,
      createdAt: payment.createdAt,
      paidAt: payment.paidAt,
      expiresAt: payment.expiresAt,
    };
  }
}

/** Keeps a signature header for forensics but strips anything bearer-shaped. */
function redactHeaders(headers: Record<string, string | string[] | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie' || lower === 'proxy-authorization') {
      out[key] = '[redacted]';
    } else {
      out[key] = value;
    }
  }
  return out;
}
