import { Logger } from '@nestjs/common';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { RivoEnv } from '../../common/env/env.schema';
import { OtpProvider, SendOtpParams, SendOtpResult } from './otp-provider.interface';
import { maskPhone } from './console-otp.provider';

/**
 * Generic HTTP SMS gateway adapter.
 *
 * Most Iraqi SMS aggregators expose the same shape: POST a JSON (or form) body
 * to one URL with an API key in a header, receive a message id back. Rather than
 * guess which vendor RIVO will sign with, the request is described by
 * configuration:
 *
 *   OTP_HTTP_URL             the endpoint
 *   OTP_HTTP_HEADERS         JSON object; {{apiKey}} is substituted
 *   OTP_HTTP_BODY_TEMPLATE   JSON body; {{phone}} {{code}} {{sender}} {{apiKey}}
 *   OTP_HTTP_MESSAGE_ID_PATH dotted path to the message id in the response
 *
 * Once the vendor is chosen, only .env changes. If the vendor needs a shape this
 * cannot express, add a dedicated adapter next to this file — the interface is
 * the contract, not this implementation.
 */
export class HttpOtpProvider implements OtpProvider {
  readonly name = 'http';
  private readonly logger = new Logger('OTP:http');

  constructor(private readonly env: RivoEnv) {}

  isConfigured(): boolean {
    return Boolean(this.env.OTP_HTTP_URL && this.env.OTP_API_KEY && this.env.OTP_HTTP_BODY_TEMPLATE);
  }

  async send(params: SendOtpParams): Promise<SendOtpResult> {
    if (!this.isConfigured()) {
      throw AppError.notConfigured('SMS OTP delivery', 'OTP_HTTP_URL / OTP_API_KEY / OTP_HTTP_BODY_TEMPLATE');
    }

    const substitutions: Record<string, string> = {
      phone: params.phoneE164,
      // The plus sign trips up some gateways that expect a bare MSISDN.
      phoneDigits: params.phoneE164.replace(/^\+/, ''),
      code: params.code,
      sender: this.env.OTP_SENDER_ID,
      apiKey: this.env.OTP_API_KEY ?? '',
      ttl: String(params.ttlSeconds),
    };

    const body = applyTemplate(this.env.OTP_HTTP_BODY_TEMPLATE as string, substitutions);
    const headers = this.buildHeaders(substitutions);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let response: Response;
    try {
      response = await fetch(this.env.OTP_HTTP_URL as string, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(`SMS gateway unreachable for ${maskPhone(params.phoneE164)}: ${reason}`);
      throw new AppError(502, {
        code: ErrorCode.OTP_SEND_FAILED,
        message: `SMS gateway request failed: ${reason}`,
        messageAr: 'تعذّر إرسال رمز التحقق. يرجى المحاولة بعد قليل.',
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    if (!response.ok) {
      // The response body may echo the code, so it is never logged verbatim.
      this.logger.error(`SMS gateway rejected message for ${maskPhone(params.phoneE164)}: HTTP ${response.status}`);
      throw new AppError(502, {
        code: ErrorCode.OTP_SEND_FAILED,
        message: `SMS gateway returned HTTP ${response.status}`,
        messageAr: 'تعذّر إرسال رمز التحقق. يرجى المحاولة بعد قليل.',
        details: { status: response.status },
      });
    }

    return { provider: this.name, providerRef: extractMessageId(text, this.env.OTP_HTTP_MESSAGE_ID_PATH) };
  }

  private buildHeaders(substitutions: Record<string, string>): Record<string, string> {
    const raw = this.env.OTP_HTTP_HEADERS?.trim();
    if (!raw) return { 'Content-Type': 'application/json' };
    try {
      const parsed = JSON.parse(applyTemplate(raw, substitutions)) as Record<string, string>;
      return { 'Content-Type': 'application/json', ...parsed };
    } catch {
      this.logger.warn('OTP_HTTP_HEADERS is not valid JSON; falling back to Content-Type only');
      return { 'Content-Type': 'application/json' };
    }
  }
}

/** Replaces {{name}} placeholders, JSON-escaping each value. */
function applyTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) return '';
    // Strip the surrounding quotes JSON.stringify adds — the template supplies them.
    return JSON.stringify(value).slice(1, -1);
  });
}

/** Reads a dotted path such as `data.messageId` out of a JSON response. */
function extractMessageId(responseText: string, path: string): string | undefined {
  try {
    let cursor: unknown = JSON.parse(responseText);
    for (const segment of path.split('.')) {
      if (cursor === null || typeof cursor !== 'object') return undefined;
      cursor = (cursor as Record<string, unknown>)[segment];
    }
    return cursor === undefined || cursor === null ? undefined : String(cursor);
  } catch {
    return undefined;
  }
}
