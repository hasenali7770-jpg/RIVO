import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  OTP_CODE_LENGTH,
  OTP_MAX_REQUESTS_PER_HOUR,
  OTP_MAX_REQUESTS_PER_IP_PER_HOUR,
  OTP_MAX_VERIFY_ATTEMPTS,
  OTP_TTL_SECONDS,
} from '@rivo/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { generateNumericCode, hashSecret, randomToken, verifySecret } from '../../common/crypto/hash';
import { OTP_PROVIDER, OtpProvider } from '../../integrations/otp/otp-provider.interface';
import { maskPhone } from '../../integrations/otp/console-otp.provider';
import { EnvService } from '../../common/env/env.service';
import { TokenPair, TokenService } from './token.service';
import { RequestOtpDto, VerifyOtpDto } from './dto/auth.dto';

export interface RequestOtpResult {
  challengeToken: string;
  expiresInSeconds: number;
  /** Present only when OTP_PROVIDER=console, so a developer can complete the flow. */
  devCode?: string;
}

export interface AuthResult extends TokenPair {
  user: {
    id: string;
    phone: string;
    displayName: string | null;
    sellerType: string;
    locale: string;
    isNew: boolean;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokens: TokenService,
    private readonly env: EnvService,
    @Inject(OTP_PROVIDER) private readonly otp: OtpProvider,
  ) {}

  /**
   * Issues a one-time code.
   *
   * Rate limited on two axes (Master Plan §13 "OTP abuse controls"): per phone
   * number, so one number cannot be spammed with SMS the client pays for; and
   * per IP, so one attacker cannot enumerate many numbers.
   */
  async requestOtp(dto: RequestOtpDto, ip: string | null): Promise<RequestOtpResult> {
    await this.enforceOtpRateLimits(dto.phone, ip);

    const code = generateNumericCode(OTP_CODE_LENGTH);
    const challengeToken = randomToken(24);
    const codeHash = await hashSecret(code);
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

    // Older unconsumed challenges for this number are invalidated so a user who
    // taps "resend" cannot accidentally verify against a stale code.
    await this.prisma.otpChallenge.updateMany({
      where: { phoneE164: dto.phone, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });

    let providerRef: string | undefined;
    let providerName = this.otp.name;
    try {
      const result = await this.otp.send({
        phoneE164: dto.phone,
        code,
        ttlSeconds: OTP_TTL_SECONDS,
        locale: dto.locale ?? 'ar',
      });
      providerRef = result.providerRef;
      providerName = result.provider;
    } catch (err) {
      // The challenge row is only written after successful delivery, so a user
      // is never left holding a token for a code that never arrived.
      this.logger.error(`OTP delivery failed for ${maskPhone(dto.phone)}`);
      if (err instanceof AppError) throw err;
      throw new AppError(502, {
        code: ErrorCode.OTP_SEND_FAILED,
        message: 'Could not deliver the verification code',
        messageAr: 'تعذّر إرسال رمز التحقق. يرجى المحاولة بعد قليل.',
      });
    }

    await this.prisma.otpChallenge.create({
      data: {
        phoneE164: dto.phone,
        codeHash,
        challengeToken,
        purpose: 'LOGIN',
        maxAttempts: OTP_MAX_VERIFY_ATTEMPTS,
        expiresAt,
        requestIp: ip,
        providerRef,
        providerName,
      },
    });

    return {
      challengeToken,
      expiresInSeconds: OTP_TTL_SECONDS,
      // Returned only in the console (development) mode, never in production —
      // EnvService refuses to boot with OTP_PROVIDER=console in production.
      devCode: this.env.get('OTP_PROVIDER') === 'console' ? code : undefined,
    };
  }

  async verifyOtp(dto: VerifyOtpDto, ip: string | null, userAgent: string | null): Promise<AuthResult> {
    const challenge = await this.prisma.otpChallenge.findUnique({
      where: { challengeToken: dto.challengeToken },
    });

    if (!challenge || challenge.phoneE164 !== dto.phone) {
      throw new AppError(400, {
        code: ErrorCode.OTP_INVALID,
        message: 'Verification challenge not found',
        messageAr: 'رمز التحقق غير صالح. يرجى طلب رمز جديد.',
      });
    }

    if (challenge.consumedAt) {
      throw new AppError(400, {
        code: ErrorCode.OTP_INVALID,
        message: 'This verification code has already been used',
        messageAr: 'تم استخدام هذا الرمز مسبقاً. يرجى طلب رمز جديد.',
      });
    }

    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new AppError(400, {
        code: ErrorCode.OTP_EXPIRED,
        message: 'Verification code expired',
        messageAr: 'انتهت صلاحية رمز التحقق. يرجى طلب رمز جديد.',
      });
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new AppError(429, {
        code: ErrorCode.OTP_TOO_MANY_ATTEMPTS,
        message: 'Too many incorrect attempts for this code',
        messageAr: 'محاولات كثيرة غير صحيحة. يرجى طلب رمز جديد.',
      });
    }

    const matches = await verifySecret(dto.code, challenge.codeHash);
    if (!matches) {
      const updated = await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true, maxAttempts: true },
      });
      const remaining = Math.max(0, updated.maxAttempts - updated.attempts);
      throw new AppError(400, {
        code: ErrorCode.OTP_INVALID,
        message: 'Incorrect verification code',
        messageAr: 'رمز التحقق غير صحيح.',
        details: { attemptsRemaining: remaining },
      });
    }

    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    const existing = await this.prisma.user.findUnique({ where: { phoneE164: dto.phone } });
    if (existing?.blockedAt) {
      throw new AppError(403, {
        code: ErrorCode.ACCOUNT_BLOCKED,
        message: 'Account is blocked',
        messageAr: 'تم إيقاف هذا الحساب. يرجى التواصل مع الدعم.',
      });
    }

    const isNew = !existing;
    const user =
      existing ??
      (await this.prisma.user.create({
        data: {
          phoneE164: dto.phone,
          phoneVerified: true,
          locale: 'ar',
        },
      }));

    if (existing && !existing.phoneVerified) {
      await this.prisma.user.update({ where: { id: user.id }, data: { phoneVerified: true } });
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });

    const device = dto.deviceKey
      ? await this.prisma.userDevice.upsert({
          where: { userId_deviceKey: { userId: user.id, deviceKey: dto.deviceKey } },
          create: {
            userId: user.id,
            deviceKey: dto.deviceKey,
            platform: dto.platform ?? 'unknown',
            appVersion: dto.appVersion,
            osVersion: dto.osVersion,
            model: dto.deviceModel,
            lastActiveAt: new Date(),
          },
          update: {
            platform: dto.platform ?? 'unknown',
            appVersion: dto.appVersion,
            osVersion: dto.osVersion,
            model: dto.deviceModel,
            lastActiveAt: new Date(),
          },
        })
      : null;

    // A successful sign-in clears the abuse counters for this number.
    await this.redis.client.del(this.otpPhoneKey(dto.phone));

    const pair = await this.tokens.issuePair({
      userId: user.id,
      phoneE164: user.phoneE164,
      deviceId: device?.id ?? null,
      ip,
      userAgent,
    });

    return {
      ...pair,
      user: {
        id: user.id,
        phone: user.phoneE164,
        displayName: user.displayName,
        sellerType: user.sellerType,
        locale: user.locale,
        isNew,
      },
    };
  }

  async refresh(refreshToken: string, ip: string | null, userAgent: string | null): Promise<TokenPair> {
    return this.tokens.rotate({ refreshToken, ip, userAgent });
  }

  async logout(params: { userId: string; refreshToken?: string; allDevices?: boolean }): Promise<{ revoked: number }> {
    if (params.allDevices) {
      const revoked = await this.tokens.revokeAllForUser(params.userId);
      return { revoked };
    }
    if (params.refreshToken) {
      await this.tokens.revokeByToken(params.refreshToken);
      return { revoked: 1 };
    }
    return { revoked: 0 };
  }

  async listSessions(userId: string) {
    const sessions = await this.prisma.refreshSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { device: true },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      ip: s.ip,
      device: s.device
        ? { platform: s.device.platform, model: s.device.model, appVersion: s.device.appVersion }
        : null,
    }));
  }

  private otpPhoneKey(phone: string): string {
    return `otp:req:phone:${phone}`;
  }

  private async enforceOtpRateLimits(phone: string, ip: string | null): Promise<void> {
    const hour = 3600;

    const perPhone = await this.redis.incrementWindow(this.otpPhoneKey(phone), hour);
    if (perPhone.count > OTP_MAX_REQUESTS_PER_HOUR) {
      throw new AppError(429, {
        code: ErrorCode.RATE_LIMITED,
        message: `Too many verification codes requested for this number. Try again in ${Math.ceil(perPhone.ttl / 60)} minutes.`,
        messageAr: `طلبات كثيرة لرمز التحقق. يرجى المحاولة بعد ${Math.ceil(perPhone.ttl / 60)} دقيقة.`,
        details: { retryAfterSeconds: perPhone.ttl },
      });
    }

    if (ip) {
      const perIp = await this.redis.incrementWindow(`otp:req:ip:${ip}`, hour);
      if (perIp.count > OTP_MAX_REQUESTS_PER_IP_PER_HOUR) {
        throw new AppError(429, {
          code: ErrorCode.RATE_LIMITED,
          message: `Too many verification codes requested from this network. Try again in ${Math.ceil(perIp.ttl / 60)} minutes.`,
          messageAr: `طلبات كثيرة من هذه الشبكة. يرجى المحاولة لاحقاً.`,
          details: { retryAfterSeconds: perIp.ttl },
        });
      }
    }
  }
}
