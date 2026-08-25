import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ADMIN_ROLES, INCIDENT_TYPES, PROPERTY_STATUSES } from '@rivo/config';

export class AdminLoginDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(8)
  currentPassword!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  newPassword!: string;
}

export class CreateAdminDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName!: string;

  @ApiProperty({ enum: ADMIN_ROLES })
  @IsIn(ADMIN_ROLES as unknown as string[])
  role!: string;

  @ApiProperty({ minLength: 12, description: 'The new admin must change this on first sign-in.' })
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  temporaryPassword!: string;
}

export class SetActiveDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}

export class ModerationDecisionDto {
  @ApiPropertyOptional({ description: 'Internal note. Optional on approval.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class RejectionDto {
  @ApiProperty({ minLength: 10, description: 'Shown to the seller verbatim.' })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}

export class BlockUserDto {
  @ApiProperty()
  @IsBoolean()
  blocked!: boolean;

  @ApiPropertyOptional({ description: 'Required when blocking.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SettlePaymentDto {
  @ApiProperty({ description: 'Transfer or receipt number for the money actually received.' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  reference!: string;

  @ApiProperty({ minLength: 10, description: 'How the payment was received.' })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  note!: string;
}

export class ResolveReportDto {
  @ApiProperty({ enum: ['ACTIONED', 'DISMISSED'] })
  @IsIn(['ACTIONED', 'DISMISSED'])
  status!: 'ACTIONED' | 'DISMISSED';

  @ApiProperty()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  note!: string;
}

export class VerificationDecisionDto {
  @ApiProperty({ enum: ['VERIFIED', 'REJECTED'] })
  @IsIn(['VERIFIED', 'REJECTED'])
  decision!: 'VERIFIED' | 'REJECTED';

  @ApiPropertyOptional({ description: 'Required when rejecting.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class SetFlagDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

export const PROPERTY_STATUS_VALUES = PROPERTY_STATUSES;
export const INCIDENT_TYPE_VALUES = INCIDENT_TYPES;
