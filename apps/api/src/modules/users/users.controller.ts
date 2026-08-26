import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SELLER_TYPES } from '@rivo/config';
import type { SellerType } from '@prisma/client';
import { UsersService } from './users.service';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators';
import { SavePlaceDto, UpdatePrivacyDto, UpdateProfileDto, UpdateSellerProfileDto } from './dto/user.dto';

class RequestVerificationDto {
  @IsIn(SELLER_TYPES as unknown as string[])
  requestedType!: string;

  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  documentKeys!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'The signed-in user profile' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.getProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update display name, locale, account type or avatar' })
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  @Patch('me/privacy')
  @ApiOperation({
    summary: 'Update privacy settings',
    description:
      'Turning off telemetry stops collection immediately. Raw samples already collected are purged by the retention job; anonymous aggregates, which cannot identify a person, are retained.',
  })
  updatePrivacy(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePrivacyDto) {
    return this.users.updatePrivacy(user.id, dto);
  }

  @Patch('me/seller-profile')
  @ApiOperation({ summary: 'Create or update the seller/office profile' })
  updateSellerProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateSellerProfileDto) {
    return this.users.upsertSellerProfile(user.id, dto);
  }

  @Post('me/verification')
  @ApiOperation({
    summary: 'Request seller verification',
    description: 'Submits documents for admin review. The verified badge appears only after an admin approves.',
  })
  requestVerification(@CurrentUser() user: AuthenticatedUser, @Body() dto: RequestVerificationDto) {
    return this.users.requestVerification(user.id, {
      requestedType: dto.requestedType as SellerType,
      documentKeys: dto.documentKeys,
      note: dto.note,
    });
  }

  @Get('me/devices')
  @ApiOperation({ summary: 'Devices signed in to this account' })
  devices(@CurrentUser() user: AuthenticatedUser) {
    return this.users.listDevices(user.id);
  }

  @Get('me/places')
  @ApiOperation({ summary: 'Saved destinations (Home, Work, custom)' })
  places(@CurrentUser() user: AuthenticatedUser) {
    return this.users.listSavedPlaces(user.id);
  }

  @Post('me/places')
  @ApiOperation({ summary: 'Save a destination. HOME and WORK replace any existing entry.' })
  savePlace(@CurrentUser() user: AuthenticatedUser, @Body() dto: SavePlaceDto) {
    return this.users.saveePlace(user.id, dto);
  }

  @Delete('me/places/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a saved destination' })
  deletePlace(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.users.deleteSavedPlace(user.id, id);
  }
}
