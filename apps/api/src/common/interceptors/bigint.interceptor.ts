import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * `JSON.stringify` throws on BigInt, and property prices are BigInt because
 * Iraqi dinar amounts exceed 2^31. Rather than sprinkling `.toString()` through
 * every controller, values are converted once on the way out.
 *
 * Prices are emitted as JSON strings, not numbers: 250,000,000,000 IQD is still
 * exact in a double, but a client that parses into a 32-bit int would silently
 * truncate. A string forces the client to be explicit.
 */
@Injectable()
export class BigIntInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => convert(data)));
  }
}

function convert(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(convert);
  if (typeof value === 'object') {
    // Prisma Decimal and other class instances expose toJSON; leave them alone.
    if (typeof (value as { toJSON?: unknown }).toJSON === 'function') return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = convert(v);
    return out;
  }
  return value;
}
