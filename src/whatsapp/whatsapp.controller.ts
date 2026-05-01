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

  const entries = body?.entry || [];
  let processedCount = 0;
  let ignoredCount = 0;

  for (const entry of entries) {
    const changes = entry?.changes || [];
    for (const change of changes) {
      const messages = change?.value?.messages || [];
      for (const message of messages) {
        const from = message.from;
        const text = message.text?.body;

        if (!text) {
          this.logger.warn('Non-text message received');
          ignoredCount++;
          continue;
        }

        // ⚡ respond immediately to Meta for each message
        setImmediate(async () => {
          try {
            // Redact phone number: show only last 4 digits
            const redactedPhone = from.slice(-4).padStart(from.length, '*');
            // Redact message: show only length
            const messageMetadata = `length=${text.length}`;
            this.logger.log(`User ${redactedPhone}: ${messageMetadata}`);

            const response = await this.ragService.askQuestion(text);

            await this.whatsappService.send(from, response);
          } catch (err) {
            // Sanitize error: avoid logging raw message or phone data
            const sanitizedError = err instanceof Error ? err.message : 'Unknown error';
            this.logger.error(`Failed to process message: ${sanitizedError}`);

            await this.whatsappService.send(
              from,
              'Something went wrong. Try again later.',
            );
          }
        });

        processedCount++;
      }
    }
  }

  if (processedCount === 0 && ignoredCount === 0) {
    return { status: 'IGNORED' };
  }

  return { status: 'EVENT_RECEIVED', processedCount, ignoredCount };
}}