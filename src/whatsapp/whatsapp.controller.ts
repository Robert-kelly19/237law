import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Header,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { WhatsappService } from './whatsapp.service';
import { WhatsAppWebhookDto, WhatsAppMessageDto } from './dto/whatsapp.dto';
import { WhatsAppMessageService } from './whatsapp-message.service';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private whatsappService: WhatsappService,
    private configService: ConfigService,
    private messageService: WhatsAppMessageService,
  ) {}

  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    const expectedToken = this.configService.get<string>(
      'WHATSAPP_VERIFY_TOKEN',
    );

    if (!expectedToken) {
      this.logger.error('WHATSAPP_VERIFY_TOKEN is not configured');
      return 'Verification failed';
    }

    if (mode === 'subscribe' && token && expectedToken) {
      const tokenBuf = Buffer.from(token);
      const expectedBuf = Buffer.from(expectedToken);

      if (
        tokenBuf.length !== expectedBuf.length ||
        !timingSafeEqual(tokenBuf, expectedBuf)
      ) {
        this.logger.error('Webhook verification failed: invalid token or mode');
        return 'Verification failed';
      }

      this.logger.log('Webhook verified successfully');
      return challenge;
    }

    this.logger.error('Webhook verification failed: invalid token or mode');
    return 'Verification failed';
  }

  @Post('webhook')
  @Header('Content-Type', 'application/json')
  async receiveMessage(
    @Body() body: WhatsAppWebhookDto,
  ): Promise<{ status: string }> {
    this.logger.debug(
      `Received webhook payload: ${JSON.stringify(body.object)}`,
    );

    // Persist webhook first, then trigger async processing
    await this.persistWebhook(body);
    this.processWebhookAsync(body);

    return { status: 'ok' };
  }

  private async persistWebhook(body: WhatsAppWebhookDto): Promise<void> {
    if (body.object !== 'whatsapp_business_account' || !body.entry) {
      return;
    }

    for (const entry of body.entry) {
      if (!entry.changes || !Array.isArray(entry.changes)) continue;

      for (const change of entry.changes) {
        const value = change.value;
        if (!value?.messages) continue;

        for (const message of value.messages) {
          const whatsappMessageId = message.id;
          const phoneNumber = message.from;
          const messageType = message.type || 'unknown';

          await this.messageService.createMessageRecord(
            whatsappMessageId,
            phoneNumber,
            messageType,
          );
        }
      }
    }
  }

  private processWebhookAsync(body: WhatsAppWebhookDto): void {
    setImmediate(async () => {
      try {
        await this.processWebhookPayload(body);
      } catch (error) {
        const err = error as unknown;
        if (err instanceof Error) {
          this.logger.error(
            `Failed to process webhook: ${err.message}`,
            err.stack,
          );
        } else {
          this.logger.error(`Failed to process webhook: ${String(err)}`);
        }
      }
    });
  }

  private async processWebhookPayload(body: WhatsAppWebhookDto): Promise<void> {
    if (body.object !== 'whatsapp_business_account') {
      this.logger.warn(`Unexpected webhook object type: ${body.object}`);
      return;
    }

    if (!body.entry || !Array.isArray(body.entry)) {
      this.logger.warn('No entries in webhook payload');
      return;
    }

    for (const entry of body.entry) {
      if (!entry.changes || !Array.isArray(entry.changes)) {
        continue;
      }

      for (const change of entry.changes) {
        await this.processChange(change);
      }
    }
  }

  private async processChange(change: any): Promise<void> {
    const value = change.value;

    if (!value || !value.messages) {
      return;
    }

    for (const message of value.messages) {
      try {
        const claimed = await this.messageService.markAsProcessing(message.id);
        if (!claimed) {
          this.logger.warn(`Duplicate or already processing: ${message.id}`);
          continue;
        }

        await this.whatsappService.handleIncomingMessage(message);
      } catch (error) {
        const err = error as unknown;
        if (err instanceof Error) {
          this.logger.error(
            `Failed to process message ${message.id} from ${message.from}: ${err.message}`,
          );
        } else {
          this.logger.error(
            `Failed to process message ${message.id} from ${message.from}: ${String(err)}`,
          );
        }
      }
    }
  }
}
