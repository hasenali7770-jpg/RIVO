import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { AppError, ErrorCode, ErrorCodeValue } from '../errors/app-error';

interface ErrorEnvelope {
  error: {
    code: ErrorCodeValue | string;
    message: string;
    messageAr?: string;
    details?: unknown;
    requestId: string;
    timestamp: string;
    path: string;
  };
}

/**
 * Single exit point for every error the API produces.
 *
 * Guarantees:
 *  - the response shape is always the same envelope, so clients parse one format;
 *  - internal details (SQL, stack traces, provider payloads) never reach a client;
 *  - unexpected faults are logged with a stack and reported to Sentry, and the
 *    client gets the request id needed to correlate with that log line.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request as Request & { requestId?: string }).requestId ?? 'unknown';

    const { status, body, isUnexpected } = this.normalise(exception);

    const envelope: ErrorEnvelope = {
      error: {
        ...body,
        requestId,
        timestamp: new Date().toISOString(),
        path: request.originalUrl ?? request.url,
      },
    };

    if (isUnexpected) {
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} -> ${status}: ${body.message}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      Sentry.withScope((scope) => {
        scope.setTag('request_id', requestId);
        scope.setContext('request', { method: request.method, url: request.url });
        Sentry.captureException(exception);
      });
    } else if (status >= 500) {
      this.logger.error(`[${requestId}] ${request.method} ${request.url} -> ${status}: ${body.message}`);
    } else {
      this.logger.warn(`[${requestId}] ${request.method} ${request.url} -> ${status}: ${body.code}`);
    }

    response.status(status).json(envelope);
  }

  private normalise(exception: unknown): {
    status: number;
    body: { code: string; message: string; messageAr?: string; details?: unknown };
    isUnexpected: boolean;
  } {
    if (exception instanceof AppError) {
      const payload = exception.getResponse() as { error: { code: string; message: string; messageAr?: string; details?: unknown } };
      return { status: exception.getStatus(), body: payload.error, isUnexpected: false };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();

      // Nest's ValidationPipe returns { message: string[], error, statusCode }.
      if (typeof res === 'object' && res !== null && 'message' in res) {
        const raw = (res as { message: unknown }).message;
        const messages = Array.isArray(raw) ? raw.map(String) : [String(raw)];
        return {
          status,
          body: {
            code: status === HttpStatus.BAD_REQUEST ? ErrorCode.VALIDATION_FAILED : this.codeForStatus(status),
            message: messages.join('; '),
            messageAr:
              status === HttpStatus.BAD_REQUEST ? 'البيانات المُرسلة غير صحيحة. يرجى المراجعة والمحاولة مرة أخرى.' : undefined,
            details: Array.isArray(raw) ? { violations: messages } : undefined,
          },
          isUnexpected: false,
        };
      }

      return {
        status,
        body: { code: this.codeForStatus(status), message: exception.message },
        isUnexpected: false,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      // A malformed query is our bug, not the caller's — do not leak the query text.
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        body: { code: ErrorCode.INTERNAL, message: 'Internal server error' },
        isUnexpected: true,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: ErrorCode.INTERNAL,
        message: 'Internal server error',
        messageAr: 'حدث خطأ غير متوقع. يرجى المحاولة لاحقاً.',
      },
      isUnexpected: true,
    };
  }

  private fromPrisma(e: Prisma.PrismaClientKnownRequestError): {
    status: number;
    body: { code: string; message: string; messageAr?: string; details?: unknown };
    isUnexpected: boolean;
  } {
    switch (e.code) {
      case 'P2002': {
        const target = (e.meta?.target as string[] | undefined)?.join(', ');
        return {
          status: HttpStatus.CONFLICT,
          body: {
            code: ErrorCode.CONFLICT,
            message: `A record with this ${target ?? 'value'} already exists`,
            messageAr: 'هذا السجل موجود مسبقاً.',
            details: target ? { fields: target.split(', ') } : undefined,
          },
          isUnexpected: false,
        };
      }
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          body: { code: ErrorCode.NOT_FOUND, message: 'Record not found', messageAr: 'العنصر غير موجود.' },
          isUnexpected: false,
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          body: {
            code: ErrorCode.VALIDATION_FAILED,
            message: 'Referenced record does not exist',
            messageAr: 'العنصر المرتبط غير موجود.',
          },
          isUnexpected: false,
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          body: { code: ErrorCode.INTERNAL, message: 'Internal server error' },
          isUnexpected: true,
        };
    }
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMITED;
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_FAILED;
      default:
        return status >= 500 ? ErrorCode.INTERNAL : 'ERROR';
    }
  }
}
