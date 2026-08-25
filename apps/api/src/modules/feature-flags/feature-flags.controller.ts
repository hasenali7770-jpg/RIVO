import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { FeatureFlagsService } from './feature-flags.service';

@ApiTags('config')
@Controller('config')
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Public()
  @Get('flags')
  @ApiOperation({
    summary: 'Effective feature flags for this deployment',
    description:
      'A flag is true only when an operator enabled it and the credential its feature needs is present. Clients must hide any control whose flag is false.',
  })
  flagsForClient() {
    return this.flags.all();
  }
}
