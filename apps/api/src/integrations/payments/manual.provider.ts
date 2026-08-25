import {
  CreateCheckoutParams,
  CreateCheckoutResult,
  PaymentProvider,
  WebhookOutcome,
} from './payment-provider.interface';

/**
 * Offline settlement provider — the default until the Iraqi merchant account is
 * live.
 *
 * How this is NOT a fake payment:
 *  - It returns no checkout URL and claims no online capability.
 *  - It has no webhook: `verifySignature` always returns false, so nothing
 *    arriving over the network can mark a listing paid.
 *  - The only way a payment reaches PAID under this provider is an authenticated
 *    FINANCE or SUPER_ADMIN settling it in the admin dashboard, which writes an
 *    audit-log entry naming the operator.
 *
 * That mirrors how the business will actually take 3,000 IQD before the gateway
 * exists — cash or transfer, confirmed by a person — rather than pretending an
 * online payment happened.
 */
export class ManualPaymentProvider implements PaymentProvider {
  readonly name = 'manual';
  readonly supportsOnlineCheckout = false;

  isConfigured(): boolean {
    return true;
  }

  async createCheckout(params: CreateCheckoutParams): Promise<CreateCheckoutResult> {
    return {
      checkoutUrl: null,
      instructions:
        `Listing ${params.propertyReference} requires a ${params.amountIqd.toLocaleString('en-US')} IQD fee. ` +
        `Reference: ${params.merchantRef}. The listing enters review once RIVO finance confirms the payment.`,
      instructionsAr:
        `إعلان ${params.propertyReference} يتطلب رسوم نشر ${params.amountIqd.toLocaleString('ar-IQ')} دينار عراقي. ` +
        `رقم المرجع: ${params.merchantRef}. سيتم إرسال الإعلان للمراجعة بعد تأكيد الدفع من قبل فريق ريفو.`,
    };
  }

  /**
   * Always false. There is no gateway, so there is no legitimate webhook — and
   * an unverifiable webhook must never be able to settle a payment.
   */
  verifySignature(): boolean {
    return false;
  }

  parseWebhook(): WebhookOutcome {
    return {
      kind: 'IGNORED',
      reason: 'PAYMENT_PROVIDER=manual accepts no webhooks; payments are settled by an authenticated finance operator',
      eventType: 'unsupported',
    };
  }
}
