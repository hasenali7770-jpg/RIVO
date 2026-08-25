import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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
  MinLength,
} from 'class-validator';
import {
  CONTACT_PREFERENCES,
  DEFAULT_PAGE_SIZE,
  GOVERNORATE_CODES,
  LISTING_PURPOSES,
  MAX_PAGE_SIZE,
  MAX_SEARCH_RADIUS_M,
  PROPERTY_TYPES,
} from '@rivo/config';

const toBool = ({ value }: { value: unknown }) =>
  typeof value === 'boolean' ? value : ['1', 'true', 'yes'].includes(String(value).toLowerCase());

export class CreatePropertyDto {
  @ApiProperty({ enum: PROPERTY_TYPES })
  @IsIn(PROPERTY_TYPES as unknown as string[])
  type!: string;

  @ApiProperty({ enum: LISTING_PURPOSES })
  @IsIn(LISTING_PURPOSES as unknown as string[])
  purpose!: string;

  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MinLength(8)
  @MaxLength(160)
  title!: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiProperty({
    description: 'Price in whole Iraqi dinars. Sent as a string because values exceed 2^53 is not a risk but 2^31 is.',
    example: '250000000',
  })
  @Transform(({ value }) => String(value).replace(/[,\s]/g, ''))
  @IsString()
  priceIqd!: string;

  @ApiPropertyOptional({ enum: ['MONTHLY', 'YEARLY'], description: 'Required when purpose = RENT.' })
  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY'])
  rentPeriod?: string;

  @ApiProperty({ example: 250, description: 'Area in square metres.' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1_000_000)
  areaSqm!: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  bedrooms?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  bathrooms?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  floors?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-5)
  @Max(200)
  floorNumber?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  yearBuilt?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  furnished?: boolean;

  @ApiProperty({ enum: GOVERNORATE_CODES })
  @IsIn(GOVERNORATE_CODES)
  governorate!: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine?: string;

  @ApiProperty({ description: 'Map pin latitude.' })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ description: 'Map pin longitude.' })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @ApiPropertyOptional({
    enum: ['EXACT', 'APPROXIMATE'],
    default: 'EXACT',
    description: 'APPROXIMATE publishes a jittered pin and hides the exact one. Gated by the approximate_location_option flag.',
  })
  @IsOptional()
  @IsIn(['EXACT', 'APPROXIMATE'])
  displayPrecision?: string;

  @ApiPropertyOptional({ enum: CONTACT_PREFERENCES, default: 'BOTH' })
  @IsOptional()
  @IsIn(CONTACT_PREFERENCES as unknown as string[])
  contactPreference?: string;

  @ApiPropertyOptional({ description: 'Overrides the account phone for this listing.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  contactPhone?: string;
}

export class UpdatePropertyDto extends CreatePropertyDto {
  @ApiPropertyOptional()
  @IsOptional()
  declare type: string;

  @ApiPropertyOptional()
  @IsOptional()
  declare purpose: string;

  @ApiPropertyOptional()
  @IsOptional()
  declare title: string;

  @ApiPropertyOptional()
  @IsOptional()
  declare priceIqd: string;

  @ApiPropertyOptional()
  @IsOptional()
  declare areaSqm: number;

  @ApiPropertyOptional()
  @IsOptional()
  declare governorate: string;

  @ApiPropertyOptional()
  @IsOptional()
  declare lat: number;

  @ApiPropertyOptional()
  @IsOptional()
  declare lng: number;
}

export class SearchPropertiesDto {
  @ApiPropertyOptional({ description: 'Free-text search over title, district and city.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ enum: PROPERTY_TYPES, isArray: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',').filter(Boolean)))
  @IsArray()
  @IsIn(PROPERTY_TYPES as unknown as string[], { each: true })
  type?: string[];

  @ApiPropertyOptional({ enum: LISTING_PURPOSES })
  @IsOptional()
  @IsIn(LISTING_PURPOSES as unknown as string[])
  purpose?: string;

  @ApiPropertyOptional({ description: 'Minimum price in IQD.' })
  @IsOptional()
  @Transform(({ value }) => String(value).replace(/[,\s]/g, ''))
  @IsString()
  minPrice?: string;

  @ApiPropertyOptional({ description: 'Maximum price in IQD.' })
  @IsOptional()
  @Transform(({ value }) => String(value).replace(/[,\s]/g, ''))
  @IsString()
  maxPrice?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minArea?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxArea?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  minBedrooms?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  minBathrooms?: number;

  @ApiPropertyOptional({ enum: GOVERNORATE_CODES })
  @IsOptional()
  @IsIn(GOVERNORATE_CODES)
  governorate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @ApiPropertyOptional({ description: 'Only listings whose seller is verified.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  verifiedOnly?: boolean;

  @ApiPropertyOptional({ enum: ['INDIVIDUAL', 'OFFICE', 'DEVELOPER'], description: 'Owner vs. office filter.' })
  @IsOptional()
  @IsIn(['INDIVIDUAL', 'OFFICE', 'DEVELOPER'])
  sellerType?: string;

  @ApiPropertyOptional({ description: 'Only listings that have a published Reel.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  hasReel?: boolean;

  // --- Geospatial -----------------------------------------------------------
  @ApiPropertyOptional({ description: 'Centre latitude for a radius search.' })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ description: 'Centre longitude for a radius search.' })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({ description: 'Search radius in metres.', default: 5000, maximum: MAX_SEARCH_RADIUS_M })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(MAX_SEARCH_RADIUS_M)
  radiusM?: number;

  @ApiPropertyOptional({ description: 'Map viewport as "minLng,minLat,maxLng,maxLat".' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  bbox?: string;

  // --- Paging and sorting ---------------------------------------------------
  @ApiPropertyOptional({ enum: ['newest', 'price_asc', 'price_desc', 'area_desc', 'relevance', 'distance'] })
  @IsOptional()
  @IsIn(['newest', 'price_asc', 'price_desc', 'area_desc', 'relevance', 'distance'])
  sort?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: DEFAULT_PAGE_SIZE, maximum: MAX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}

export class ReportPropertyDto {
  @ApiProperty({
    enum: ['FAKE_LISTING', 'WRONG_PRICE', 'SOLD_ALREADY', 'WRONG_LOCATION', 'OFFENSIVE', 'DUPLICATE', 'OTHER'],
  })
  @IsIn(['FAKE_LISTING', 'WRONG_PRICE', 'SOLD_ALREADY', 'WRONG_LOCATION', 'OFFENSIVE', 'DUPLICATE', 'OTHER'])
  reason!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ReorderMediaDto {
  @ApiProperty({ description: 'Media ids in the order they should appear.', type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  mediaIds!: string[];

  @ApiPropertyOptional({ description: 'Media id to use as the listing cover.' })
  @IsOptional()
  @IsUUID('4')
  coverMediaId?: string;
}
