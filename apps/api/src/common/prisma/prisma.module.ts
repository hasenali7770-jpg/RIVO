import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { GeoRepository } from '../geo/geo.repository';

@Global()
@Module({
  providers: [PrismaService, GeoRepository],
  exports: [PrismaService, GeoRepository],
})
export class PrismaModule {}
