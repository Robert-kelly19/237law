import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { maskMsisdn } from '../common/mask-msisdn';
import { CreateSmDto } from './dto/create-sm.dto';
import { SmsService } from './sms.service';

@Controller('sms')
export class SmsController {
  private readonly logger = new Logger(SmsController.name);

  constructor(
    private readonly smsService: SmsService,
    private readonly configService: ConfigService,
  ) {}

  @Post('callback')
  @HttpCode(HttpStatus.OK)
  async handleIncomingSms(
    @Headers('x-mtn-webhook-secret') webhookSecret: string | undefined,
    @Body(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    body: CreateSmDto,
  ) {
    const expectedSecret = this.configService.get<string>('MTN_WEBHOOK_SECRET');

    if (!expectedSecret || webhookSecret !== expectedSecret) {
      this.logger.warn('Rejected unauthorized MTN SMS callback');
      throw new UnauthorizedException('Unauthorized SMS callback');
    }

    const phoneNumber = body.senderAddress;
    const messageText = body.message;

    this.logger.debug(
      `Received MTN SMS callback from ${maskMsisdn(phoneNumber)} (messageLength=${messageText.length})`,
    );

    void this.smsService.processIncomingSms(phoneNumber, messageText);

    return {
      status: 'received',
    };
  }
}
