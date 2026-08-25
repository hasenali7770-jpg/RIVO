import { Global, Module } from '@nestjs/common';
import { EnvService } from '../../common/env/env.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider.interface';
import { ManualPaymentProvider } from './manual.provider';
import { HmacGatewayProvider } from './hmac-gateway.provider';

@Global()
@Module({
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      inject: [EnvService],
      useFactory: (env: EnvService): PaymentProvider =>
        env.get('PAYMENT_PROVIDER') === 'hmac_gateway'
          ? new HmacGatewayProvider(env.env)
          : new ManualPaymentProvider(),
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsIntegrationModule {}
