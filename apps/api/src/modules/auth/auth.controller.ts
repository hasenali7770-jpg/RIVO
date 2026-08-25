import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { LogoutDto, RefreshTokenDto, RequestOtpDto, VerifyOtpDto } from './dto/auth.dto';
import { AuthenticatedUser, ClientIp, CurrentUser, Public } from '../../common/decorators';
import { Headers } from '@nestjs/common';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  // A second, tighter budget on top of the per-phone and per-IP limits inside
  // AuthService. This one stops a flood before it reaches Redis or the SMS vendor.
  @RateLimit('otp', { limit: 6, ttl: 3600_000 })
  @Post('request-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a one-time login code by SMS',
    description:
      'Rate limited per phone number and per IP. In development (OTP_PROVIDER=console) the response includes `devCode` so the flow can be completed without an SMS contract; this field is never present in production.',
  })
  @ApiResponse({ status: 200, description: 'Code sent; use the returned challengeToken to verify.' })
  @ApiResponse({ status: 429, description: 'Too many code requests.' })
  @ApiResponse({ status: 502, description: 'The SMS gateway rejected or could not receive the message.' })
  requestOtp(@Body() dto: RequestOtpDto, @ClientIp() ip: string | null) {
    return this.auth.requestOtp(dto, ip);
  }

  @Public()
  @RateLimit('otp', { limit: 20, ttl: 3600_000 })
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a one-time code for an access and refresh token pair' })
  @ApiResponse({ status: 200, description: 'Signed in. Creates the account on first verification.' })
  @ApiResponse({ status: 400, description: 'Code is wrong, expired or already used.' })
  verifyOtp(
    @Body() dto: VerifyOtpDto,
    @ClientIp() ip: string | null,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.verifyOtp(dto, ip, userAgent ?? null);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token',
    description:
      'Returns a new pair and revokes the presented token. Presenting an already-rotated token is treated as theft: every session for the account is revoked.',
  })
  refresh(
    @Body() dto: RefreshTokenDto,
    @ClientIp() ip: string | null,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.refresh(dto.refreshToken, ip, userAgent ?? null);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign out of this device, or of every device' })
  logout(@CurrentUser() user: AuthenticatedUser, @Body() dto: LogoutDto) {
    return this.auth.logout({
      userId: user.id,
      refreshToken: dto.refreshToken,
      allDevices: dto.allDevices === true,
    });
  }

  @ApiBearerAuth()
  @Get('sessions')
  @ApiOperation({ summary: 'List the active sessions on this account' })
  sessions(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.listSessions(user.id);
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke one session by id' })
  async revokeSession(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.tokens.revokeSession(id, user.id);
  }
}
