import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PROPERTY_PHOTO_MAX, PROPERTY_PHOTO_MAX_BYTES, PROPERTY_PHOTO_MIN } from '@rivo/config';
import { MediaService } from './media.service';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators';
import {
  CompleteUploadDto,
  PresignImagesDto,
  RequestEnhancementDto,
  SelectMediaVersionDto,
} from './dto/media.dto';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';

class PresignUserAssetDto {
  @IsString()
  contentType!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1024)
  @Max(PROPERTY_PHOTO_MAX_BYTES)
  contentLength!: number;

  @IsIn(['avatar', 'verification'])
  purpose!: 'avatar' | 'verification';
}

@ApiTags('media')
@ApiBearerAuth()
@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @RateLimit('write', { limit: 30, ttl: 60_000 })
  @Post('uploads/images/presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get presigned R2 URLs for property photos',
    description: `Photos upload directly to Cloudflare R2; bytes never pass through the API. The ${PROPERTY_PHOTO_MAX}-photo ceiling is checked against what the listing already has, so batching cannot bypass it.`,
  })
  @ApiResponse({ status: 422, description: `The request would take the listing past ${PROPERTY_PHOTO_MAX} photos.` })
  @ApiResponse({ status: 503, description: 'R2 credentials are not configured on this deployment.' })
  presign(@Body() dto: PresignImagesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.media.presignImages(dto, user.id);
  }

  @Post('uploads/images/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm photo uploads finished',
    description:
      'Each object is verified against R2 before it is marked confirmed. Only confirmed originals count toward the 8–18 rule.',
  })
  complete(@Body() dto: CompleteUploadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.media.completeUploads(dto, user.id);
  }

  @Post('uploads/user-asset/presign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Presign an avatar or verification-document upload' })
  presignUserAsset(@Body() dto: PresignUserAssetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.media.presignUserAsset(user.id, dto);
  }

  @Delete('media/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a photo and its enhanced derivative' })
  deleteMedia(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.media.deleteMedia(id, user.id);
  }

  @Get('media/:id/compare')
  @ApiOperation({
    summary: 'Compare the original and enhanced version of a photo',
    description: `Returns both versions with the enhancement disclosure. Minimum ${PROPERTY_PHOTO_MIN} photos are required to publish.`,
  })
  compare(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.media.compareVersions(id, user.id);
  }

  @Post('media/:id/select')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Choose which version of a photo the listing publishes',
    description: 'Both versions remain stored. Selecting one never deletes the other.',
  })
  select(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SelectMediaVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.selectVersion(id, user.id, dto.use as 'ORIGINAL' | 'ENHANCED');
  }

  @Post('media/:id/enhance')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue AI enhancement for a photo' })
  @ApiResponse({ status: 503, description: 'AI enhancement is disabled or unconfigured on this deployment.' })
  enhance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestEnhancementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.requestEnhancement(id, user.id, dto.force === true);
  }

  @Get('media/jobs/:id')
  @ApiOperation({ summary: 'Status of one media or AI job' })
  jobStatus(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.media.getJobStatus(id, user.id);
  }

  @Get('properties/:id/media/jobs')
  @ApiOperation({ summary: 'All processing jobs for a listing' })
  propertyJobs(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.media.listPropertyJobs(id, user.id);
  }
}
