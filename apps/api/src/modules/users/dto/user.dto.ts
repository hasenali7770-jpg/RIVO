import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SELLER_TYPES, SUPPORTED_LOCALES } from '@rivo/config';
import { normaliseIraqiPhone } from '../../auth/dto/auth.dto';

export class UpdateProfileDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName?: string;

  @ApiPropertyOptional({ enum: SUPPORTED_LOCALES })
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES as unknown as string[])
  locale?: string;

  @ApiPropertyOptional({ enum: SELLER_TYPES })
  @IsOptional()
  @IsIn(SELLER_TYPES as unknown as string[])
  sellerType?: string;

  @ApiPropertyOptional({ description: 'R2 object key of an uploaded avatar.' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  avatarKey?: string;

  @ApiPropertyOptional({ description: 'Opt in or out of marketing messages.' })
  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;
}

export class UpdatePrivacyDto {
  @ApiPropertyOptional({
    description:
      'Consent to contribute anonymous speed samples that improve traffic estimates. Revoking stops collection immediately.',
  })
  @IsOptional()
  @IsBoolean()
  telemetryOptIn?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;
}

export class UpdateSellerProfileDto {
  @ApiPropertyOptional({ enum: SELLER_TYPES })
  @IsOptional()
  @IsIn(SELLER_TYPES as unknown as string[])
  sellerType?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  officeName?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  officeLicenseNo?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  about?: string;

  @ApiPropertyOptional({ example: '+9647701234567' })
  @IsOptional()
  @Transform(({ value }) => (value ? normaliseIraqiPhone(String(value)) : value))
  @IsString()
  @MaxLength(20)
  contactPhone?: string;

  @ApiPropertyOptional({ example: '+9647701234567' })
  @IsOptional()
  @Transform(({ value }) => (value ? normaliseIraqiPhone(String(value)) : value))
  @IsString()
  @MaxLength(20)
  whatsappPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  logoKey?: string;
}

export class SavePlaceDto {
  @ApiPropertyOptional({ enum: ['HOME', 'WORK', 'CUSTOM'] })
  @IsIn(['HOME', 'WORK', 'CUSTOM'])
  kind!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;
}
