import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { LISTING_FEE_IQD } from '@rivo/config';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { AuthenticatedUser, ClientIp, CurrentUser, Public } from '../../common/decorators';

class CreateListingPaymentDto {
  @IsUUID('4')
  propertyId!: string;
}

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @ApiBearerAuth()
  @Post('listing/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: `Create a ${LISTING_FEE_IQD} IQD listing payment`,
    description: `The amount is fixed server-side at ${LISTING_FEE_IQD} IQD and is never read from the request. The listing must be in AWAITING_PAYMENT.`,
  })
  @ApiResponse({ status: 409, description: 'The listing is not awaiting payment, or has already been paid.' })
  create(@Body() dto: CreateListingPaymentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payments.createListingPayment(dto.propertyId, user.id);
  }

  @ApiBearerAuth()
  @Get('mine')
  @ApiOperation({ summary: 'Payment history for the signed-in user' })
  mine(@CurrentUser() user: AuthenticatedUser, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.payments.listMine(user.id, Number(page) || 1, Math.min(Number(limit) || 20, 50));
  }

  @ApiBearerAuth()
  @Get(':id/status')
  @ApiOperation({
    summary: 'Current state of a payment',
    description:
      'Poll this after returning from the gateway. The value here reflects what the verified webhook reported — the app must not treat its own return screen as proof of payment.',
  })
  status(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.payments.getStatus(id, user.id);
  }

  /**
   * Gateway webhook.
   *
   * Public because the gateway cannot hold a RIVO token — authenticity comes
   * from the HMAC signature, which is verified before anything is applied. The
   * raw body is read from `req.rawBody`, captured by the middleware in main.ts,
   * because signatures are computed over exact bytes and re-serialising the
   * parsed JSON would change them.
   */
  @Public()
  @Post('webhook/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Payment gateway webhook (signature-verified)',
    description:
      'The only path that can move a payment to PAID. An unsigned or badly signed request is recorded as evidence and rejected with 401.',
  })
  @ApiResponse({ status: 200, description: 'Event received. `applied` says whether it changed anything.' })
  @ApiResponse({ status: 401, description: 'Signature verification failed.' })
  webhook(
    @Param('provider') provider: string,
    @Req() req: Request & { rawBody?: string },
    @Headers() headers: Record<string, string | string[] | undefined>,
    @ClientIp() ip: string | null,
  ) {
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    return this.payments.handleWebhook({ providerName: provider, rawBody, headers, sourceIp: ip });
  }
}
