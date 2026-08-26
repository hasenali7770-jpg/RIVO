import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AdminRole } from '@prisma/client';

/** Marks a route as reachable without a bearer token. */
export const IS_PUBLIC_KEY = 'rivo:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Marks a route as usable signed in or signed out. The guard still parses a
 * bearer token when present, so the handler can personalise (e.g. mark which
 * listings the caller has favourited) without requiring an account.
 */
export const IS_OPTIONAL_AUTH_KEY = 'rivo:optionalAuth';
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);

/** Restricts an admin route to the listed roles. */
export const ADMIN_ROLES_KEY = 'rivo:adminRoles';
export const RequireRoles = (...roles: AdminRole[]) => SetMetadata(ADMIN_ROLES_KEY, roles);

/** Marks an admin route as requiring an audit-log entry, with this action name. */
export const AUDIT_ACTION_KEY = 'rivo:auditAction';
export const Audited = (action: string, entityType: string) =>
  SetMetadata(AUDIT_ACTION_KEY, { action, entityType });

export interface AuthenticatedUser {
  id: string;
  phoneE164: string;
  sellerType: string;
}

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  role: AdminRole;
}

export type RivoRequest = Request & {
  requestId?: string;
  user?: AuthenticatedUser;
  admin?: AuthenticatedAdmin;
};

/** Injects the signed-in app user, or undefined on an OptionalAuth route. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<RivoRequest>();
  return req.user;
});

/** Injects the signed-in admin. */
export const CurrentAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<RivoRequest>();
  return req.admin;
});

export const RequestId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<RivoRequest>().requestId;
});

/**
 * Best-effort client IP. Behind Cloudflare + Nginx, `req.ip` is only correct
 * once `trust proxy` is set (see main.ts), which is why TRUST_PROXY is a
 * first-class environment variable.
 */
export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<RivoRequest>();
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;
  return req.ip ?? req.socket?.remoteAddress ?? null;
});
