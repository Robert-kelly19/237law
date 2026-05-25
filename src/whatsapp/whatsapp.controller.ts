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
import { LegalAgentService } from '../agents/legal.agent';

interface WhatsappWebhookBody {
  object?: string;
  entry: WebhookEntry[];
}

interface WebhookEntry {
  id?: string;
  changes?: WebhookChange[];
}

interface WebhookChange {
  value?: WebhookValue;
}

interface WebhookValue {
  messaging_product?: string;
  metadata?: WebhookMetadata;
  contacts?: any[];
  messages?: WebhookMessage[];
}

interface WebhookMetadata {
  display_phone_number?: string;
  phone_number_id?: string;
}

interface WebhookMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  text?: WebhookText;
  type?: string;
  [key: string]: any; // For other message types like images, videos, etc.
}

interface WebhookText {
  body?: string;
}

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private whatsappService: WhatsappService,
    private legalAgent: LegalAgentService,
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
  async receiveMessage(@Body() body: WhatsappWebhookBody) {
    this.logger.log(`Incoming webhook`);

    if (!body?.entry) {
      return { status: 'EVENT_RECEIVED' };
    }

    for (const entry of body.entry) {
      if (!entry?.changes) continue;

      for (const change of entry.changes) {
        if (!change?.value?.messages) continue;

        for (const message of change.value.messages) {
          const from = message.from;
          const text = message.text?.body;

          if (!from || !text) continue;

          try {
            // Use the agent with memory (sessions managed by agent via ConversationService)
            const response = await this.legalAgent.processQuery({
              userId: from,
              query: text,
            });

            this.logger.log(`Generated response: ${response.answer}`);
            await this.whatsappService.send(from, response.answer);
          } catch (err: any) {
            this.logger.error(
              `Agent processing error: ${err instanceof Error ? err.message : String(err)}`,
              err instanceof Error ? err.stack : undefined,
            );
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
