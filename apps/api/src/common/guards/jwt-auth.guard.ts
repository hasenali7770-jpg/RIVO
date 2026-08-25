import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError, ErrorCode } from '../errors/app-error';
import { IS_OPTIONAL_AUTH_KEY, IS_PUBLIC_KEY, RivoRequest } from '../decorators';
import { TokenService } from '../../modules/auth/token.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Bearer-token guard applied globally.
 *
 * Routes opt out with @Public(), or opt into "authenticate if a token is present"
 * with @OptionalAuth(). Making authentication the default and exemption explicit
 * means a new endpoint is private until someone deliberately opens it.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const isOptional = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<RivoRequest>();
    const token = extractBearer(request.headers.authorization);

    if (!token) {
      if (isOptional) return true;
      throw AppError.unauthorized({
        message: 'Authentication required',
        messageAr: 'يرجى تسجيل الدخول للمتابعة.',
      });
    }

    let payload;
    try {
      payload = await this.tokens.verifyAccessToken(token);
    } catch (err) {
      if (isOptional) return true;
      throw err;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, phoneE164: true, sellerType: true, blockedAt: true, deletedAt: true },
    });

    if (!user || user.deletedAt) {
      if (isOptional) return true;
      throw AppError.unauthorized({ message: 'Account no longer exists' });
    }

    // A block takes effect immediately, without waiting for the 15-minute access
    // token to expire.
    if (user.blockedAt) {
      throw new AppError(403, {
        code: ErrorCode.ACCOUNT_BLOCKED,
        message: 'Account is blocked',
        messageAr: 'تم إيقاف هذا الحساب. يرجى التواصل مع الدعم.',
      });
    }

    request.user = { id: user.id, phoneE164: user.phoneE164, sellerType: user.sellerType };
    return true;
  }
}

export function extractBearer(header?: string): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme.toLowerCase() !== 'bearer') return null;
  return value.trim() || null;
}
