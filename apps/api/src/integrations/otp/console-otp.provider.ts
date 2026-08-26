import { Logger } from '@nestjs/common';
import { OtpProvider, SendOtpParams, SendOtpResult } from './otp-provider.interface';

/**
 * Development-only adapter: prints the code to the API log instead of sending an
 * SMS, so the phone-OTP flow is testable end to end with no vendor contract.
 *
 * This is a sandbox mode, explicitly permitted by Master Plan §0, not a fake
 * integration: no credential is invented, nothing claims an SMS was delivered,
 * and `EnvService` refuses to boot with this provider when APP_ENV=production.
 */
export class ConsoleOtpProvider implements OtpProvider {
  readonly name = 'console';
  private readonly logger = new Logger('OTP:console');

  isConfigured(): boolean {
    return true;
  }

  async send(params: SendOtpParams): Promise<SendOtpResult> {
    this.logger.warn(
      `DEV OTP — no SMS was sent. phone=${maskPhone(params.phoneE164)} code=${params.code} (valid ${params.ttlSeconds}s)`,
    );
    return { provider: this.name };
  }
}

/** Leaves the country code and last two digits visible: +964*******67. */
export function maskPhone(phone: string): string {
  if (phone.length <= 6) return '***';
  return `${phone.slice(0, 4)}${'*'.repeat(Math.max(0, phone.length - 6))}${phone.slice(-2)}`;
}
