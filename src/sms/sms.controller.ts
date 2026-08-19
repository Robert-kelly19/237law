import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';

import { SmsService } from './sms.service';

@Controller('sms')
export class SmsController {
  private readonly logger =
    new Logger(SmsController.name);

  constructor(
    private readonly smsService: SmsService,
  ) {}

  
  @Post('callback')
  @HttpCode(HttpStatus.OK)
  async handleIncomingSms(
    @Body() body: any,
  ) {
    this.logger.log(
      `Received MTN SMS callback: ${JSON.stringify(body)}`,
    );

    
    const phoneNumber =
      body.senderAddress;

    const messageText =
      body.message;

    if (!phoneNumber || !messageText) {
      this.logger.warn(
        'Invalid MTN SMS callback payload',
      );

      return {
        status: 'ignored',
        message:
          'Missing senderAddress or message',
      };
    }

    
    await this.smsService.processIncomingSms(
      phoneNumber,
      messageText,
    );

    return {
      status: 'received',
    };
  }
}