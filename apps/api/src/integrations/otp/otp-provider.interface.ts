/**
 * SMS OTP delivery contract — Master Plan §12.
 *
 * The production Iraqi SMS vendor is not selected yet, so the domain layer talks
 * only to this interface. Swapping vendors means adding one adapter and changing
 * `OTP_PROVIDER`; no auth code changes.
 */
export interface SendOtpParams {
  /** E.164 destination, e.g. +9647701234567. */
  phoneE164: string;
  /** The plaintext code. Implementations must not log or persist it. */
  code: string;
  /** Seconds the code stays valid, for inclusion in the message body. */
  ttlSeconds: number;
  locale: string;
}

export interface SendOtpResult {
  /** Provider-side message id, stored for delivery troubleshooting. */
  providerRef?: string;
  /** Adapter name, recorded on the challenge row. */
  provider: string;
}

export interface OtpProvider {
  readonly name: string;
  /**
   * Delivers the code. MUST throw on failure — a provider that swallows an error
   * would leave a user waiting for an SMS that was never sent, with the API
   * reporting success.
   */
  send(params: SendOtpParams): Promise<SendOtpResult>;
  /** False when a required credential is missing. */
  isConfigured(): boolean;
}

export const OTP_PROVIDER = Symbol('OTP_PROVIDER');
