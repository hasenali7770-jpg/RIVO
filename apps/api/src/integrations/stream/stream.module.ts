import { Global, Module } from '@nestjs/common';
import { StreamService } from './stream.service';

@Global()
@Module({
  providers: [StreamService],
  exports: [StreamService],
})
export class StreamModule {}
