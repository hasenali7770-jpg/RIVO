import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { LISTING_PURPOSES, PROPERTY_TYPES, REEL_MIN_SHORT_EDGE } from '@rivo/config';
import { ReelsService } from './reels.service';
import { AuthenticatedUser, CurrentUser, OptionalAuth } from '../../common/decorators';

class CreateReelUploadDto {
  @IsUUID('4')
  propertyId!: string;
}

class FinishUploadDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  caption?: string;
}

class SetCoverDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  seconds!: number;
}

class UpdateCaptionDto {
  @IsString()
  @MaxLength(300)
  caption!: string;
}

class ViewEventDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  watchedSeconds!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  completion!: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  anonId?: string;
}

class FeedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsIn(LISTING_PURPOSES as unknown as string[])
  purpose?: string;

  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',').filter(Boolean)))
  @IsArray()
  @IsIn(PROPERTY_TYPES as unknown as string[], { each: true })
  type?: string[];

  @IsOptional()
  @IsString()
  governorate?: string;

  @IsOptional()
  @Transform(({ value }) => String(value).replace(/[,\s]/g, ''))
  @IsString()
  maxPrice?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(50)
  limit?: number;
}

@ApiTags('reels')
@Controller('reels')
export class ReelsController {
  constructor(private readonly reels: ReelsService) {}

  @OptionalAuth()
  @Get('feed')
  @ApiOperation({
    summary: 'Property Reels feed',
    description:
      'Vertical, property-only feed. Ranked on recency, distance, watch completion, saves and verification. Every reel is bound to a published listing — there is no general social content.',
  })
  feed(@Query() query: FeedQueryDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.reels.getFeed({ ...query, viewerId: user?.id ?? null });
  }

  @ApiBearerAuth()
  @Throttle({ write: { limit: 10, ttl: 3600_000 } })
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start a reel upload for one of your listings',
    description:
      'Returns a Cloudflare Stream direct-creator-upload URL. The reel is bound to the listing before upload; a reel with no property cannot exist.',
  })
  @ApiResponse({ status: 404, description: 'The listing does not exist or is not yours.' })
  @ApiResponse({ status: 503, description: 'Cloudflare Stream is not configured on this deployment.' })
  createUpload(@Body() dto: CreateReelUploadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reels.createUpload(dto.propertyId, user.id);
  }

  @ApiBearerAuth()
  @Post(':id/uploaded')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tell the API the file finished uploading',
    description: `Queues server-side validation. Resolution and duration are measured on the server; anything under ${REEL_MIN_SHORT_EDGE}p is refused regardless of what the client reports.`,
  })
  finishUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FinishUploadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reels.notifyUploadFinished(id, user.id, dto.caption);
  }

  @ApiBearerAuth()
  @Get(':id/status')
  @ApiOperation({ summary: 'Processing and validation state of your reel' })
  status(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reels.getStatus(id, user.id);
  }

  @ApiBearerAuth()
  @Patch(':id/caption')
  @ApiOperation({ summary: 'Update the reel caption' })
  updateCaption(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCaptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reels.updateCaption(id, user.id, dto.caption);
  }

  @ApiBearerAuth()
  @Post(':id/cover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Choose the cover frame timestamp' })
  setCover(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCoverDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reels.setCover(id, user.id, dto.seconds);
  }

  @ApiBearerAuth()
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete your reel' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reels.deleteReel(id, user.id);
  }

  @OptionalAuth()
  @Get(':id')
  @ApiOperation({ summary: 'One reel with its linked listing' })
  getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.reels.getOne(id, user?.id ?? null);
  }

  @OptionalAuth()
  @Post(':id/view-event')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Report watch time for feed ranking',
    description: 'Completion is clamped to 0–1 on the server so a client cannot inflate its own ranking.',
  })
  viewEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ViewEventDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.reels.recordView(id, {
      userId: user?.id ?? null,
      anonId: dto.anonId,
      watchedSeconds: dto.watchedSeconds,
      completion: dto.completion,
    });
  }
}
