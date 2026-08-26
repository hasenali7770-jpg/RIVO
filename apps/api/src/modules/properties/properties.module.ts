import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { PropertySearchRepository } from './property-search.repository';

@Module({
  controllers: [PropertiesController],
  providers: [PropertiesService, PropertySearchRepository],
  exports: [PropertiesService],
})
export class PropertiesModule {}
