import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Header,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsAppWebhookDto, WhatsAppMessageDto } from './dto/whatsapp.dto';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(private whatsappService: WhatsappService) {}

  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      this.logger.log('Webhook verified successfully');
      return challenge;
    } else {
      this.logger.error('Webhook verification failed: invalid token or mode');
      return 'Verification failed';
    }
  }

  @Post('webhook')
  @Header('Content-Type', 'application/json')
  async receiveMessage(
    @Body(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    body: WhatsAppWebhookDto,
  ): Promise<{ status: string }> {
    this.logger.debug('Received webhook payload', { object: body.object });

    // Process asynchronously to acknowledge webhook quickly
    this.processWebhookAsync(body);

    return { status: 'ok' };
  }

  private processWebhookAsync(body: WhatsAppWebhookDto): void {
    setImmediate(async () => {
      try {
        await this.processWebhookPayload(body);
      } catch (error) {
        this.logger.error(
          `Failed to process webhook: ${error.message}`,
          error.stack,
        );
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

    // Process ALL messages in the batch (not just the first one)
    for (const message of value.messages) {
      try {
        await this.whatsappService.handleIncomingMessage(message);
      } catch (error) {
        this.logger.error(
          `Failed to process message ${message.id} from ${message.from}: ${error.message}`,
        );
        // Continue processing remaining messages
      }
    }
  }
}
