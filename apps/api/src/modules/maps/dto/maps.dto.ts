import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ROUTE_MAX_ALTERNATIVES } from '@rivo/config';

export class SearchPlacesDto {
  @ApiProperty({ example: 'شارع فلسطين' })
  @IsString()
  @MaxLength(120)
  q!: string;

  @ApiPropertyOptional({ description: 'Bias results toward this latitude.' })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ description: 'Bias results toward this longitude.' })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({ default: 8, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;

  @ApiPropertyOptional({ enum: ['ar', 'en'], default: 'ar' })
  @IsOptional()
  @IsIn(['ar', 'en'])
  language?: string;
}

export class WaypointDto {
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lng!: number;
}

export class RouteRequestDto {
  @ApiProperty({ type: WaypointDto })
  @ValidateNested()
  @Type(() => WaypointDto)
  origin!: WaypointDto;

  @ApiProperty({ type: WaypointDto })
  @ValidateNested()
  @Type(() => WaypointDto)
  destination!: WaypointDto;

  @ApiPropertyOptional({ type: [WaypointDto], maxItems: 3 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => WaypointDto)
  waypoints?: WaypointDto[];

  @ApiPropertyOptional({ default: true, description: `Return up to ${ROUTE_MAX_ALTERNATIVES} alternatives.` })
  @IsOptional()
  alternatives?: boolean;

  @ApiPropertyOptional({ description: 'Compass bearing of travel, so a reroute does not begin with a U-turn.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(360)
  originBearing?: number;

  @ApiPropertyOptional({ enum: ['toll', 'motorway', 'ferry'], isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(['toll', 'motorway', 'ferry'], { each: true })
  avoid?: Array<'toll' | 'motorway' | 'ferry'>;

  @ApiPropertyOptional({ enum: ['ar', 'en'], default: 'ar' })
  @IsOptional()
  @IsIn(['ar', 'en'])
  language?: string;

  @ApiPropertyOptional({ description: 'Route to this listing. Uses the listing’s published coordinates.' })
  @IsOptional()
  @IsUUID('4')
  propertyId?: string;
}

export class RouteFeedbackDto {
  @ApiProperty({ description: 'requestId from the /maps/routes response.' })
  @IsString()
  @MaxLength(64)
  routeRequestId!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  predictedSeconds!: number;

  @ApiPropertyOptional({ description: 'Actual travel time. Omit when the trip was abandoned.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  actualSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  distanceM?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  rerouteCount?: number;

  @ApiProperty({ enum: ['COMPLETED', 'ABANDONED', 'REROUTED_AWAY'] })
  @IsIn(['COMPLETED', 'ABANDONED', 'REROUTED_AWAY'])
  outcome!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ maxLength: 280 })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  comment?: string;

  @ApiProperty({ type: WaypointDto })
  @ValidateNested()
  @Type(() => WaypointDto)
  origin!: WaypointDto;

  @ApiProperty({ type: WaypointDto })
  @ValidateNested()
  @Type(() => WaypointDto)
  destination!: WaypointDto;
}
