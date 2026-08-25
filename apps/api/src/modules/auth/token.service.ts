import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EnvService } from '../../common/env/env.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { randomToken, sha256Hex } from '../../common/crypto/hash';
import { AppError, ErrorCode } from '../../common/errors/app-error';

export interface AccessTokenPayload {
  sub: string;
  phone: string;
  typ: 'access';
  /** Session id, so a revoked session invalidates its access tokens on refresh. */
  sid?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

/**
 * Access + refresh token issuing with rotation.
 *
 * Access tokens are short-lived JWTs (15 min) verified statelessly. Refresh
 * tokens are opaque random strings stored only as SHA-256 hashes, so a database
 * dump cannot be replayed as a login. Every refresh rotates: the old row is
 * revoked and linked to its replacement, which makes reuse of a stolen token
 * detectable.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  private get refreshTtlMs(): number {
    return this.env.get('JWT_REFRESH_TTL_DAYS') * 24 * 60 * 60 * 1000;
  }

  async issuePair(params: {
    userId: string;
    phoneE164: string;
    deviceId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<TokenPair> {
    const refreshToken = randomToken(48);
    const session = await this.prisma.refreshSession.create({
      data: {
        userId: params.userId,
        deviceId: params.deviceId ?? null,
        tokenHash: sha256Hex(refreshToken),
        ip: params.ip ?? null,
        userAgent: params.userAgent?.slice(0, 512) ?? null,
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
      },
    });

    const payload: AccessTokenPayload = {
      sub: params.userId,
      phone: params.phoneE164,
      typ: 'access',
      sid: session.id,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.env.get('JWT_ACCESS_SECRET'),
      // JWT_ACCESS_TTL is validated as a zeit/ms string ("15m") by the env schema,
      // but jsonwebtoken types it as a narrow literal union, so it is widened here.
      expiresIn: this.env.get('JWT_ACCESS_TTL') as unknown as number,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: parseTtlSeconds(this.env.get('JWT_ACCESS_TTL')),
      tokenType: 'Bearer',
    };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.env.get('JWT_ACCESS_SECRET'),
      });
      if (payload.typ !== 'access') {
        throw AppError.unauthorized({ message: 'Token is not an access token' });
      }
      return payload;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw AppError.unauthorized({ message: 'Access token is invalid or expired' });
    }
  }

  /**
   * Rotates a refresh token.
   *
   * Reuse detection: presenting a token that has already been rotated means the
   * token leaked, so the whole family is revoked and the caller must sign in
   * again. This is the standard OAuth refresh-token-rotation defence.
   */
  async rotate(params: {
    refreshToken: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<TokenPair> {
    const tokenHash = sha256Hex(params.refreshToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session) {
      throw new AppError(401, {
        code: ErrorCode.REFRESH_TOKEN_INVALID,
        message: 'Refresh token not recognised',
        messageAr: 'انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.',
      });
    }

    if (session.revokedAt) {
      await this.revokeAllForUser(session.userId, 'refresh_token_reuse_detected');
      throw new AppError(401, {
        code: ErrorCode.REFRESH_TOKEN_INVALID,
        message: 'Refresh token was already used; all sessions for this account have been revoked',
        messageAr: 'تم اكتشاف استخدام غير آمن للجلسة. يرجى تسجيل الدخول مرة أخرى.',
      });
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new AppError(401, {
        code: ErrorCode.REFRESH_TOKEN_INVALID,
        message: 'Refresh token expired',
        messageAr: 'انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.',
      });
    }

    if (session.user.blockedAt) {
      throw new AppError(403, {
        code: ErrorCode.ACCOUNT_BLOCKED,
        message: 'Account is blocked',
        messageAr: 'تم إيقاف هذا الحساب. يرجى التواصل مع الدعم.',
      });
    }

    const pair = await this.issuePair({
      userId: session.userId,
      phoneE164: session.user.phoneE164,
      deviceId: session.deviceId,
      ip: params.ip,
      userAgent: params.userAgent,
    });

    const replacement = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: sha256Hex(pair.refreshToken) },
      select: { id: true },
    });

    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: {
        revokedAt: new Date(),
        revokedReason: 'rotated',
        replacedById: replacement?.id ?? null,
        lastUsedAt: new Date(),
      },
    });

    return pair;
  }

  async revokeByToken(refreshToken: string, reason = 'logout'): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash: sha256Hex(refreshToken), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAllForUser(userId: string, reason = 'logout_all'): Promise<number> {
    const result = await this.prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  async revokeSession(sessionId: string, userId: string, reason = 'logout'): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}

/** Converts a zeit/ms style TTL ("15m", "3600", "2h") to seconds. */
export function parseTtlSeconds(ttl: string): number {
  const match = /^(\d+)\s*(s|m|h|d)?$/.exec(ttl.trim());
  if (!match) return 900;
  const value = Number(match[1]);
  switch (match[2]) {
    case 'm':
      return value * 60;
    case 'h':
      return value * 3600;
    case 'd':
      return value * 86400;
    default:
      return value;
  }
}
