import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminRole } from '@prisma/client';
import { AppError } from '../errors/app-error';
import { ADMIN_ROLES_KEY, IS_PUBLIC_KEY, RivoRequest } from '../decorators';
import { PrismaService } from '../prisma/prisma.service';
import { sha256Hex } from '../crypto/hash';
import { extractBearer } from './jwt-auth.guard';

/**
 * Guards every /admin route.
 *
 * Admin sessions are opaque server-side tokens rather than JWTs: an operator
 * being removed must lose access instantly, and a stateless token cannot offer
 * that. Master Plan §9 requires role-based access on every admin operation, so a
 * route with no @RequireRoles is refused rather than defaulting to open.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RivoRequest>();
    const token = extractBearer(request.headers.authorization);
    if (!token) {
      throw AppError.unauthorized({ message: 'Admin authentication required' });
    }

    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { admin: true },
    });

    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw AppError.unauthorized({ message: 'Admin session is invalid or expired' });
    }
    if (!session.admin.isActive) {
      throw AppError.forbidden({ message: 'This admin account is disabled' });
    }

    request.admin = { id: session.admin.id, email: session.admin.email, role: session.admin.role };

    const required = this.reflector.getAllAndOverride<AdminRole[]>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      // Fail closed: an admin route that forgot its @RequireRoles is a bug, and
      // silently allowing it would be a privilege-escalation hole.
      throw AppError.forbidden({
        message: 'This admin route declares no role requirement and is therefore refused',
      });
    }

    // SUPER_ADMIN passes every check by definition.
    if (session.admin.role !== 'SUPER_ADMIN' && !required.includes(session.admin.role)) {
      throw AppError.forbidden({
        message: `This action requires one of: ${required.join(', ')}`,
        details: { requiredRoles: required, yourRole: session.admin.role },
      });
    }

    return true;
  }
}
