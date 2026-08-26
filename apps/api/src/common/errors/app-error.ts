import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Machine-readable error codes. The mobile app switches on these rather than on
 * HTTP status or message text, so Arabic/English copy can change without
 * breaking clients.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',

  // Auth
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_TOO_MANY_ATTEMPTS: 'OTP_TOO_MANY_ATTEMPTS',
  OTP_SEND_FAILED: 'OTP_SEND_FAILED',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  ACCOUNT_BLOCKED: 'ACCOUNT_BLOCKED',

  // Darcom
  PHOTO_COUNT_TOO_LOW: 'PHOTO_COUNT_TOO_LOW',
  PHOTO_COUNT_TOO_HIGH: 'PHOTO_COUNT_TOO_HIGH',
  PHOTO_TYPE_UNSUPPORTED: 'PHOTO_TYPE_UNSUPPORTED',
  PHOTO_TOO_LARGE: 'PHOTO_TOO_LARGE',
  UPLOAD_NOT_CONFIRMED: 'UPLOAD_NOT_CONFIRMED',
  PROPERTY_INVALID_STATE: 'PROPERTY_INVALID_STATE',
  PROPERTY_INCOMPLETE: 'PROPERTY_INCOMPLETE',

  // Reels
  REEL_RESOLUTION_TOO_LOW: 'REEL_RESOLUTION_TOO_LOW',
  REEL_DURATION_INVALID: 'REEL_DURATION_INVALID',
  REEL_NOT_LINKED_TO_PROPERTY: 'REEL_NOT_LINKED_TO_PROPERTY',
  REEL_ALREADY_EXISTS: 'REEL_ALREADY_EXISTS',

  // Payments
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  PAYMENT_ALREADY_PAID: 'PAYMENT_ALREADY_PAID',
  PAYMENT_SIGNATURE_INVALID: 'PAYMENT_SIGNATURE_INVALID',
  PAYMENT_PROVIDER_ERROR: 'PAYMENT_PROVIDER_ERROR',

  // Integrations
  INTEGRATION_NOT_CONFIGURED: 'INTEGRATION_NOT_CONFIGURED',
  INTEGRATION_UPSTREAM_ERROR: 'INTEGRATION_UPSTREAM_ERROR',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface AppErrorBody {
  code: ErrorCodeValue;
  /** English message for developers and logs. */
  message: string;
  /** Arabic message safe to show to an end user. */
  messageAr?: string;
  /** Field-level detail, or provider context. Never contains secrets. */
  details?: Record<string, unknown>;
}

/**
 * Base class for every error RIVO raises deliberately. Anything that is not an
 * AppError or HttpException is treated as an unexpected fault by the exception
 * filter: it is logged with a stack trace and reported to Sentry, and the client
 * receives a generic INTERNAL response with a request id.
 */
export class AppError extends HttpException {
  readonly code: ErrorCodeValue;
  readonly messageAr?: string;
  readonly details?: Record<string, unknown>;

  constructor(status: HttpStatus, body: AppErrorBody) {
    super({ error: body }, status);
    this.code = body.code;
    this.messageAr = body.messageAr;
    this.details = body.details;
  }

  static badRequest(body: AppErrorBody) {
    return new AppError(HttpStatus.BAD_REQUEST, body);
  }
  static unauthorized(body: Partial<AppErrorBody> & { message: string }) {
    return new AppError(HttpStatus.UNAUTHORIZED, { code: ErrorCode.UNAUTHORIZED, ...body });
  }
  static forbidden(body: Partial<AppErrorBody> & { message: string }) {
    return new AppError(HttpStatus.FORBIDDEN, { code: ErrorCode.FORBIDDEN, ...body });
  }
  static notFound(body: Partial<AppErrorBody> & { message: string }) {
    return new AppError(HttpStatus.NOT_FOUND, { code: ErrorCode.NOT_FOUND, ...body });
  }
  static conflict(body: Partial<AppErrorBody> & { message: string }) {
    return new AppError(HttpStatus.CONFLICT, { code: ErrorCode.CONFLICT, ...body });
  }
  static tooManyRequests(body: Partial<AppErrorBody> & { message: string }) {
    return new AppError(HttpStatus.TOO_MANY_REQUESTS, { code: ErrorCode.RATE_LIMITED, ...body });
  }
  static unprocessable(body: AppErrorBody) {
    return new AppError(HttpStatus.UNPROCESSABLE_ENTITY, body);
  }
  static badGateway(body: Partial<AppErrorBody> & { message: string }) {
    return new AppError(HttpStatus.BAD_GATEWAY, { code: ErrorCode.INTEGRATION_UPSTREAM_ERROR, ...body });
  }

  /**
   * Raised when a feature is requested but its credential is absent. Deliberately
   * a 503 rather than a 500: the deployment is incomplete, not broken, and the
   * message names the exact variable an operator must set.
   */
  static notConfigured(integration: string, envVar: string) {
    return new AppError(HttpStatus.SERVICE_UNAVAILABLE, {
      code: ErrorCode.INTEGRATION_NOT_CONFIGURED,
      message: `${integration} is not configured on this deployment. Set ${envVar} and restart the API.`,
      messageAr: 'هذه الميزة غير مفعّلة حالياً. يرجى المحاولة لاحقاً.',
      details: { integration, requiredEnv: envVar },
    });
  }

  static featureDisabled(flag: string) {
    return new AppError(HttpStatus.SERVICE_UNAVAILABLE, {
      code: ErrorCode.FEATURE_DISABLED,
      message: `Feature "${flag}" is disabled.`,
      messageAr: 'هذه الميزة غير متاحة حالياً.',
      details: { flag },
    });
  }
}
