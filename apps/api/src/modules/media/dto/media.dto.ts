import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import {
  PROPERTY_PHOTO_MAX,
  PROPERTY_PHOTO_MAX_BYTES,
  PROPERTY_PHOTO_MIME_TYPES,
} from '@rivo/config';

export class PresignItemDto {
  @ApiProperty({ enum: PROPERTY_PHOTO_MIME_TYPES })
  @IsIn(PROPERTY_PHOTO_MIME_TYPES as unknown as string[])
  contentType!: string;

  @ApiProperty({ description: 'Exact byte length of the file.', maximum: PROPERTY_PHOTO_MAX_BYTES })
  @Type(() => Number)
  @IsInt()
  @Min(1024)
  @Max(PROPERTY_PHOTO_MAX_BYTES)
  contentLength!: number;

  @ApiPropertyOptional({ description: 'SHA-256 of the file, used to detect duplicate uploads.' })
  @IsOptional()
  @IsString()
  checksumSha256?: string;
}

export class PresignImagesDto {
  @ApiProperty({ description: 'Draft listing the photos belong to.' })
  @IsUUID('4')
  propertyId!: string;

  @ApiProperty({ type: [PresignItemDto], maxItems: PROPERTY_PHOTO_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PROPERTY_PHOTO_MAX)
  @ValidateNested({ each: true })
  @Type(() => PresignItemDto)
  files!: PresignItemDto[];
}

export class CompleteUploadItemDto {
  @ApiProperty()
  @IsUUID('4')
  mediaId!: string;
}

export class CompleteUploadDto {
  @ApiProperty({ type: [CompleteUploadItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PROPERTY_PHOTO_MAX)
  @ValidateNested({ each: true })
  @Type(() => CompleteUploadItemDto)
  items!: CompleteUploadItemDto[];
}

export class SelectMediaVersionDto {
  @ApiProperty({
    enum: ['ORIGINAL', 'ENHANCED'],
    description: 'Which version of this photo appears in the published listing.',
  })
  @IsIn(['ORIGINAL', 'ENHANCED'])
  use!: string;
}

export class RequestEnhancementDto {
  @ApiPropertyOptional({ description: 'Re-run enhancement even if a result already exists.' })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
