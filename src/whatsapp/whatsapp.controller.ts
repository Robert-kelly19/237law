import {
  Controller,
  Post,
  Body,
  Query,
  Res,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { WhatsappService } from './whatsapp.service';
import { RagService } from '../rag.service';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private whatsappService: WhatsappService,
    private ragService: RagService,
  ) {}

  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      this.logger.log('Webhook verified successfully');
      res.status(HttpStatus.OK).send(challenge);
    } else {
      this.logger.warn('Webhook verification failed');
      res.sendStatus(HttpStatus.FORBIDDEN);
    }
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receiveMessage(@Body() body: any) {
    this.logger.log(`Incoming webhook`);

    for (const entry of body?.entry || []) {
      for (const change of entry?.changes || []) {
        const value = change?.value;

        if (!value?.messages) continue;

        for (const message of value.messages) {
          const from = message.from;
          const text = message.text?.body;

          if (!text) continue;

          try {
            const response = await this.ragService.askQuestion(text);
            this.logger.log(`Generated response: ${response}`);
            await this.whatsappService.send(from, response);
          } catch (err) {
            await this.whatsappService.send(
              from,
              'Something went wrong. Try again later.',
            );
          }
        }
      }
    }

    return { status: 'EVENT_RECEIVED' };
  }
}