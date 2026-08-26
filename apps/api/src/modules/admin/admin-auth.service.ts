import { Injectable, Logger } from '@nestjs/common';
import type { AdminRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnvService } from '../../common/env/env.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { hashSecret, randomToken, sha256Hex, verifySecret } from '../../common/crypto/hash';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Admin sign-in.
   *
   * Failed attempts lock the account for a period rather than only rate-limiting
   * by IP, because an admin password is a far more valuable target than a user
   * account and an attacker can rotate IPs.
   */
  async login(email: string, password: string, ip: string | null, userAgent: string | null) {
    const admin = await this.prisma.adminUser.findUnique({ where: { email: email.toLowerCase().trim() } });

    // The same message and a comparable amount of work either way, so the
    // response does not reveal whether the address exists.
    const genericFailure = () =>
      AppError.unauthorized({ message: 'Email or password is incorrect' });

    if (!admin) {
      await hashSecret(password);
      throw genericFailure();
    }

    if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((admin.lockedUntil.getTime() - Date.now()) / 60_000);
      throw AppError.forbidden({
        message: `This account is locked for another ${minutes} minute(s) after too many failed sign-ins`,
      });
    }

    if (!admin.isActive) {
      throw AppError.forbidden({ message: 'This admin account is disabled' });
    }

    const ok = await verifySecret(password, admin.passwordHash);
    if (!ok) {
      const failed = admin.failedLoginCount + 1;
      await this.prisma.adminUser.update({
        where: { id: admin.id },
        data: {
          failedLoginCount: failed,
          ...(failed >= MAX_FAILED_LOGINS
            ? { lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000), failedLoginCount: 0 }
            : {}),
        },
      });
      this.logger.warn(`Failed admin sign-in for ${admin.email} from ${ip ?? 'unknown IP'} (attempt ${failed})`);
      throw genericFailure();
    }

    const token = randomToken(48);
    const ttlHours = this.env.get('ADMIN_SESSION_TTL_HOURS');

    await this.prisma.$transaction([
      this.prisma.adminSession.create({
        data: {
          adminId: admin.id,
          tokenHash: sha256Hex(token),
          ip,
          userAgent: userAgent?.slice(0, 512),
          expiresAt: new Date(Date.now() + ttlHours * 3600_000),
        },
      }),
      this.prisma.adminUser.update({
        where: { id: admin.id },
        data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
      }),
    ]);

    await this.audit.record({
      adminId: admin.id,
      action: 'admin.login',
      entityType: 'admin',
      entityId: admin.id,
      ip,
      userAgent,
    });

    return {
      token,
      expiresAt: new Date(Date.now() + ttlHours * 3600_000),
      admin: {
        id: admin.id,
        email: admin.email,
        displayName: admin.displayName,
        role: admin.role,
        mustChangePassword: admin.mustChangePassword,
      },
    };
  }

  async logout(adminId: string, token: string) {
    await this.prisma.adminSession.updateMany({
      where: { adminId, tokenHash: sha256Hex(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { loggedOut: true };
  }

  async changePassword(adminId: string, currentPassword: string, newPassword: string, ip: string | null) {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });

    if (!(await verifySecret(currentPassword, admin.passwordHash))) {
      throw AppError.unauthorized({ message: 'Current password is incorrect' });
    }
    if (newPassword.length < 12) {
      throw AppError.badRequest({
        code: 'VALIDATION_FAILED' as never,
        message: 'The new password must be at least 12 characters',
      });
    }
    if (await verifySecret(newPassword, admin.passwordHash)) {
      throw AppError.badRequest({
        code: 'VALIDATION_FAILED' as never,
        message: 'The new password must differ from the current one',
      });
    }

    await this.prisma.$transaction([
      this.prisma.adminUser.update({
        where: { id: adminId },
        data: { passwordHash: await hashSecret(newPassword), mustChangePassword: false },
      }),
      // Every other session is dropped: after a password change, any session an
      // attacker holds must die.
      this.prisma.adminSession.updateMany({
        where: { adminId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'password_changed' },
      }),
    ]);

    await this.audit.record({
      adminId,
      action: 'admin.change_password',
      entityType: 'admin',
      entityId: adminId,
      ip,
    });

    return { changed: true, note: 'All admin sessions were signed out. Please sign in again.' };
  }

  /** Creates an admin. Super Admin only; the new account must change its password. */
  async createAdmin(params: {
    actorId: string;
    email: string;
    displayName: string;
    role: AdminRole;
    temporaryPassword: string;
    ip: string | null;
  }) {
    if (params.temporaryPassword.length < 12) {
      throw AppError.badRequest({
        code: 'VALIDATION_FAILED' as never,
        message: 'The temporary password must be at least 12 characters',
      });
    }
    const created = await this.prisma.adminUser.create({
      data: {
        email: params.email.toLowerCase().trim(),
        displayName: params.displayName,
        role: params.role,
        passwordHash: await hashSecret(params.temporaryPassword),
        mustChangePassword: true,
      },
      select: { id: true, email: true, displayName: true, role: true },
    });

    await this.audit.record({
      adminId: params.actorId,
      action: 'admin.create',
      entityType: 'admin',
      entityId: created.id,
      changes: { email: created.email, role: created.role },
      ip: params.ip,
    });

    return created;
  }

  async listAdmins() {
    return this.prisma.adminUser.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async setActive(actorId: string, adminId: string, isActive: boolean, ip: string | null) {
    if (actorId === adminId && !isActive) {
      throw AppError.badRequest({
        code: 'VALIDATION_FAILED' as never,
        message: 'You cannot disable your own account',
      });
    }

    // The last active Super Admin cannot be disabled, or nobody can administer
    // the platform.
    const target = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    if (!isActive && target.role === 'SUPER_ADMIN') {
      const remaining = await this.prisma.adminUser.count({
        where: { role: 'SUPER_ADMIN', isActive: true, id: { not: adminId } },
      });
      if (remaining === 0) {
        throw AppError.conflict({ message: 'At least one active Super Admin must remain' });
      }
    }

    await this.prisma.adminUser.update({ where: { id: adminId }, data: { isActive } });
    if (!isActive) {
      await this.prisma.adminSession.updateMany({
        where: { adminId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'account_disabled' },
      });
    }

    await this.audit.record({
      adminId: actorId,
      action: isActive ? 'admin.enable' : 'admin.disable',
      entityType: 'admin',
      entityId: adminId,
      ip,
    });

    return { id: adminId, isActive };
  }

  /**
   * Creates the bootstrap Super Admin from the environment, if no admin exists.
   * Called by the seed script. Never overwrites an existing account.
   */
  async ensureBootstrapAdmin(): Promise<{ created: boolean; email?: string }> {
    const count = await this.prisma.adminUser.count();
    if (count > 0) return { created: false };

    const email = this.env.get('ADMIN_BOOTSTRAP_EMAIL');
    const password = this.env.get('ADMIN_BOOTSTRAP_PASSWORD');
    if (!email || !password) {
      this.logger.warn(
        'No admin accounts exist and ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD are not set — the admin dashboard cannot be signed into',
      );
      return { created: false };
    }

    await this.prisma.adminUser.create({
      data: {
        email: email.toLowerCase().trim(),
        displayName: 'RIVO Super Admin',
        role: 'SUPER_ADMIN',
        passwordHash: await hashSecret(password),
        mustChangePassword: true,
      },
    });
    this.logger.log(`Bootstrap Super Admin created for ${email}. It must change its password on first sign-in.`);
    return { created: true, email };
  }
}
