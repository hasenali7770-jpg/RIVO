import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Attaches a request id to every request and echoes it back as `x-request-id`.
 * Master Plan §17 requires request ids; this is what makes a user-reported error
 * traceable to one log line and one Sentry event.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { requestId?: string }, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    // An inbound id is honoured (so a trace survives the reverse proxy) but
    // length-capped so it cannot be used to bloat logs.
    const id =
      typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 64 ? incoming : randomUUID();
    req.requestId = id;
    res.setHeader('x-request-id', id);
    next();
  }
}
