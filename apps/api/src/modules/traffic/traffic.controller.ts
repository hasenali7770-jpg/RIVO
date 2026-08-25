import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { INCIDENT_TYPES, TELEMETRY_RAW_RETENTION_DAYS } from '@rivo/config';
import { TrafficService } from './traffic.service';
import { AuthenticatedUser, CurrentUser, OptionalAuth } from '../../common/decorators';
import { ConfirmIncidentDto, CreateIncidentDto, ListIncidentsDto, TelemetryBatchDto } from './dto/traffic.dto';

@ApiTags('traffic')
@Controller('traffic')
export class TrafficController {
  constructor(private readonly traffic: TrafficService) {}

  @OptionalAuth()
  @Get('incidents')
  @ApiOperation({
    summary: 'Active road incidents in a viewport or radius',
    description: `Returns accidents, jams, closures, road works, flooded roads, potholes and hazards (${INCIDENT_TYPES.join(', ')}). A report the community voted down is hidden. The reporter is never identified.`,
  })
  list(@Query() dto: ListIncidentsDto) {
    return this.traffic.listIncidents(dto);
  }

  @ApiBearerAuth()
  @Throttle({ write: { limit: 20, ttl: 3600_000 } })
  @Post('incidents')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Report a road condition',
    description:
      'A report within 120 m of an existing report of the same type is merged into it as a confirmation rather than creating a duplicate pin.',
  })
  @ApiResponse({ status: 409, description: 'You already reported this location recently.' })
  create(@Body() dto: CreateIncidentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.traffic.createIncident(dto, user.id);
  }

  @ApiBearerAuth()
  @Post('incidents/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm or dismiss a report',
    description: 'Votes are weighted by how close the voter is. You cannot vote on your own report, or vote twice.',
  })
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmIncidentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.traffic.confirmIncident(id, user.id, dto);
  }

  @ApiBearerAuth()
  @Get('incidents/mine')
  @ApiOperation({ summary: 'Your own reports' })
  mine(@CurrentUser() user: AuthenticatedUser, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.traffic.myIncidents(user.id, Number(page) || 1, Math.min(Number(limit) || 20, 50));
  }

  @ApiBearerAuth()
  @Throttle({ write: { limit: 120, ttl: 3600_000 } })
  @Post('telemetry/batch')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Contribute anonymous speed samples',
    description:
      `Requires an explicit account-level opt-in AND a per-batch consent flag. Samples are stored with a rotating pseudonymous session key and NO account identifier, ` +
      `and raw samples are deleted after ${TELEMETRY_RAW_RETENTION_DAYS} days. Only aggregates built from at least 5 distinct sessions are ever readable.`,
  })
  @ApiResponse({ status: 403, description: 'Telemetry is not enabled on this account.' })
  telemetry(@Body() dto: TelemetryBatchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.traffic.ingestTelemetry(dto, user.id);
  }

  @OptionalAuth()
  @Get('segments')
  @ApiOperation({
    summary: 'Aggregated segment speeds for a viewport',
    description:
      'Live where recent samples exist, otherwise the typical speed for this time of week. Built only from k-anonymous aggregates.',
  })
  segments(@Query('bbox') bbox: string) {
    return this.traffic.segmentSpeeds(bbox);
  }
}
