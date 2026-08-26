import { Global, Module } from '@nestjs/common';
import { EnvService } from '../../common/env/env.service';
import { ConsoleOtpProvider } from './console-otp.provider';
import { HttpOtpProvider } from './http-otp.provider';
import { OTP_PROVIDER, OtpProvider } from './otp-provider.interface';

@Global()
@Module({
  providers: [
    {
      provide: OTP_PROVIDER,
      inject: [EnvService],
      useFactory: (env: EnvService): OtpProvider =>
        env.get('OTP_PROVIDER') === 'http' ? new HttpOtpProvider(env.env) : new ConsoleOtpProvider(),
    },
  ],
  exports: [OTP_PROVIDER],
})
export class OtpModule {}
