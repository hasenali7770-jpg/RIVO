import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { OTP_CODE_LENGTH } from '@rivo/config';

/**
 * Iraqi mobile numbers in E.164. Accepts the three ways users actually type
 * them — 07XXXXXXXXX, 9647XXXXXXXXX, +9647XXXXXXXXX — and normalises to +964…
 * before validation, because rejecting the local format would fail most users.
 */
export function normaliseIraqiPhone(input: string): string {
  const digits = String(input ?? '')
    .replace(/[\s\-()]/g, '')
    .replace(/^00/, '+');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('964')) return `+${digits}`;
  if (digits.startsWith('0')) return `+964${digits.slice(1)}`;
  return `+964${digits}`;
}

export class RequestOtpDto {
  @ApiProperty({
    example: '+9647701234567',
    description: 'Phone number. 07XXXXXXXXX and 9647XXXXXXXXX are accepted and normalised to E.164.',
  })
  @Transform(({ value }) => normaliseIraqiPhone(String(value)))
  @Matches(/^\+[1-9][0-9]{7,14}$/, { message: 'phone must be a valid international number' })
  phone!: string;

  @ApiPropertyOptional({ enum: ['ar', 'en', 'ku'], default: 'ar' })
  @IsOptional()
  @IsIn(['ar', 'en', 'ku'])
  locale?: string;

  @ApiPropertyOptional({ description: 'Stable per-install device identifier.' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceKey?: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: '+9647701234567' })
  @Transform(({ value }) => normaliseIraqiPhone(String(value)))
  @Matches(/^\+[1-9][0-9]{7,14}$/, { message: 'phone must be a valid international number' })
  phone!: string;

  @ApiProperty({ description: 'Opaque token returned by /auth/request-otp.' })
  @IsString()
  @Length(10, 64)
  challengeToken!: string;

  @ApiProperty({ example: '123456', minLength: OTP_CODE_LENGTH, maxLength: OTP_CODE_LENGTH })
  @Matches(new RegExp(`^[0-9]{${OTP_CODE_LENGTH}}$`), { message: `code must be ${OTP_CODE_LENGTH} digits` })
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceKey?: string;

  @ApiPropertyOptional({ enum: ['android', 'ios', 'web'] })
  @IsOptional()
  @IsIn(['android', 'ios', 'web'])
  platform?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  appVersion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  osVersion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceModel?: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @Length(10, 512)
  refreshToken!: string;
}

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Refresh token to revoke. Omit to revoke the current device only.' })
  @IsOptional()
  @IsString()
  @Length(10, 512)
  refreshToken?: string;

  @ApiPropertyOptional({ description: 'Revoke every session for this account.', default: false })
  @IsOptional()
  allDevices?: boolean;
}
