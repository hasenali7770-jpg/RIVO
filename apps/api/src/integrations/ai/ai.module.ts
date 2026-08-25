import { Global, Module } from '@nestjs/common';
import { EnvService } from '../../common/env/env.service';
import { AI_PROVIDER, AiProvider } from './ai-provider.interface';
import { ReplicateProvider } from './replicate.provider';
import { NoopAiProvider } from './noop.provider';

@Global()
@Module({
  providers: [
    {
      provide: AI_PROVIDER,
      inject: [EnvService],
      useFactory: (env: EnvService): AiProvider =>
        env.get('AI_PROVIDER') === 'replicate' ? new ReplicateProvider(env.env) : new NoopAiProvider(),
    },
  ],
  exports: [AI_PROVIDER],
})
export class AiModule {}
