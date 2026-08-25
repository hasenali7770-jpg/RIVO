import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PROPERTY_PHOTO_MAX, PROPERTY_PHOTO_MIN } from '@rivo/config';
import { PropertiesService } from './properties.service';
import { AuthenticatedUser, CurrentUser, OptionalAuth } from '../../common/decorators';
import {
  CreatePropertyDto,
  ReorderMediaDto,
  ReportPropertyDto,
  SearchPropertiesDto,
  UpdatePropertyDto,
} from './dto/property.dto';

@ApiTags('properties')
@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  // --- Discovery (public) ----------------------------------------------------

  @OptionalAuth()
  @Get()
  @ApiOperation({
    summary: 'Search published listings',
    description:
      'Supports type, sale/rent, price, area, bedrooms, bathrooms, verified-only, owner/office, radius and viewport filtering, with newest/price/area/relevance/distance sorting. Signing in adds `isFavorited` to each result.',
  })
  search(@Query() dto: SearchPropertiesDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.properties.searchPublic(dto, user?.id ?? null);
  }

  @OptionalAuth()
  @Get('map')
  @ApiOperation({
    summary: 'Price pins for the map viewport',
    description: 'Returns a trimmed payload suitable for rendering hundreds of pins. Capped at 500 per request.',
  })
  @ApiQuery({ name: 'bbox', required: true, example: '44.30,33.28,44.45,33.36' })
  mapPins(@Query('bbox') bbox: string, @Query() filters: SearchPropertiesDto) {
    return this.properties.mapPins(bbox, filters);
  }

  // --- Owner listings --------------------------------------------------------

  @ApiBearerAuth()
  @Get('mine')
  @ApiOperation({ summary: 'The signed-in user’s own listings, in any status' })
  mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.properties.listMine(user.id, status, Number(page) || 1, Math.min(Number(limit) || 20, 50));
  }

  @ApiBearerAuth()
  @Get('favorites')
  @ApiOperation({ summary: 'Saved listings' })
  favorites(@CurrentUser() user: AuthenticatedUser, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.properties.listFavorites(user.id, Number(page) || 1, Math.min(Number(limit) || 20, 50));
  }

  // --- Detail ----------------------------------------------------------------

  @OptionalAuth()
  @Get(':id')
  @ApiOperation({ summary: 'Public listing detail' })
  @ApiResponse({ status: 404, description: 'No published listing with this id.' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.properties.getPublic(id, user?.id ?? null);
  }

  @ApiBearerAuth()
  @Get(':id/edit')
  @ApiOperation({
    summary: 'Owner view of a listing',
    description:
      'Includes the exact pin, unconfirmed media, AI enhancement state, payment history, moderation notes and a checklist of what is still missing before submission.',
  })
  getForEdit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.properties.getForOwner(id, user.id);
  }

  // --- Create and edit -------------------------------------------------------

  @ApiBearerAuth()
  @Throttle({ write: { limit: 20, ttl: 60_000 } })
  @Post()
  @ApiOperation({ summary: 'Create a draft listing' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePropertyDto) {
    return this.properties.create(user.id, dto);
  }

  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update a draft listing' })
  @ApiResponse({ status: 409, description: 'The listing is in a status that cannot be edited.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.properties.update(id, user.id, dto);
  }

  @ApiBearerAuth()
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit a listing for payment and review',
    description: `Enforces the photo rule server-side: fewer than ${PROPERTY_PHOTO_MIN} or more than ${PROPERTY_PHOTO_MAX} confirmed photos is refused. On success the listing moves to AWAITING_PAYMENT; only a settled payment moves it to review.`,
  })
  @ApiResponse({ status: 422, description: 'Photo count outside 8–18, or required fields missing.' })
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.properties.submit(id, user.id);
  }

  @ApiBearerAuth()
  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move a rejected listing back to draft so it can be corrected' })
  reopen(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.properties.reopenForEdit(id, user.id);
  }

  @ApiBearerAuth()
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a published listing' })
  archive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.properties.changeLifecycle(id, user.id, 'archive');
  }

  @ApiBearerAuth()
  @Post(':id/sold')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a listing as sold' })
  markSold(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.properties.changeLifecycle(id, user.id, 'markSold');
  }

  @ApiBearerAuth()
  @Post(':id/rented')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a listing as rented' })
  markRented(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.properties.changeLifecycle(id, user.id, 'markRented');
  }

  @ApiBearerAuth()
  @Post(':id/media/reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reorder gallery photos and choose the cover' })
  reorderMedia(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReorderMediaDto,
  ) {
    return this.properties.reorderMedia(id, user.id, dto);
  }

  // --- Engagement ------------------------------------------------------------

  @ApiBearerAuth()
  @Post(':id/favorite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save a listing' })
  favorite(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.properties.favorite(id, user.id);
  }

  @ApiBearerAuth()
  @Delete(':id/favorite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a saved listing' })
  unfavorite(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.properties.unfavorite(id, user.id);
  }

  @OptionalAuth()
  @Throttle({ write: { limit: 10, ttl: 3600_000 } })
  @Post(':id/report')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Report a listing as fake, misleading or offensive' })
  report(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportPropertyDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.properties.report(id, user?.id ?? null, dto.reason, dto.note);
  }
}
