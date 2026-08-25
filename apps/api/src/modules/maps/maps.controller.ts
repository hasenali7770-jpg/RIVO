import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MapsService } from './maps.service';
import { AuthenticatedUser, CurrentUser, OptionalAuth } from '../../common/decorators';
import { RouteFeedbackDto, RouteRequestDto, SearchPlacesDto } from './dto/maps.dto';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';

@ApiTags('maps')
@Controller('maps')
export class MapsController {
  constructor(private readonly maps: MapsService) {}

  @OptionalAuth()
  @RateLimit('routing', { limit: 60, ttl: 60_000 })
  @Get('search')
  @ApiOperation({
    summary: 'Search for a place in Iraq',
    description:
      'Proxied to Mapbox Geocoding server-side so the secret token never reaches a device. Results are biased to Iraq and, when coordinates are supplied, to the user’s surroundings.',
  })
  @ApiResponse({ status: 503, description: 'Mapbox is not configured on this deployment.' })
  search(@Query() dto: SearchPlacesDto) {
    return this.maps.searchPlaces(dto);
  }

  @OptionalAuth()
  @RateLimit('routing', { limit: 30, ttl: 60_000 })
  @Post('routes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Calculate a traffic-aware route',
    description:
      'Uses the Mapbox driving-traffic profile. Returns the best route plus alternatives, each with distance, free-flow duration, duration in traffic, the resulting delay, turn-by-turn steps and the polyline — enriched with any active RIVO incident within 60 m of the line. Pass `propertyId` to route to a listing (the `اذهب إلى العقار` action).',
  })
  @ApiResponse({ status: 422, description: 'No route exists between these points.' })
  route(@Body() dto: RouteRequestDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.maps.route(dto, user?.id ?? null);
  }

  @OptionalAuth()
  @Post('route-feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Report how a route actually went',
    description: 'Predicted vs. actual travel time. Feeds ETA calibration for the RIVO traffic engine.',
  })
  feedback(@Body() dto: RouteFeedbackDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.maps.recordRouteFeedback(dto, user?.id ?? null);
  }

  @OptionalAuth()
  @Get('property/:id/destination')
  @ApiOperation({
    summary: 'Destination coordinates for a listing',
    description: 'Backs the `اذهب إلى العقار` button when the app wants to set a destination without routing yet.',
  })
  destination(@Param('id', ParseUUIDPipe) id: string) {
    return this.maps.propertyDestination(id);
  }
}
