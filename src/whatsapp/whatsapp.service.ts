import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ky from 'ky';
import { createHash } from 'crypto';
import { RagService } from 'src/rag.service';
import { WhatsAppMessageService } from './whatsapp-message.service';

function maskPhone(phoneNumber: string): string {
  if (!phoneNumber || phoneNumber.length < 4) return '****';
  return phoneNumber.slice(0, -4).replace(/./g, '*') + phoneNumber.slice(-4);
}

function hashIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

interface WhatsAppErrorResponse {
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id: string;
    error_data?: Record<string, any>;
  };
}

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly MAX_RETRIES = 3;
  private readonly BASE_DELAY_MS = 1000;
  private whatsappConfig: {
    accessToken: string;
    phoneNumberId: string;
    version: string;
  };

  constructor(
    private ragService: RagService,
    private messageService: WhatsAppMessageService,
    private configService: ConfigService,
  ) {
    const accessToken = this.configService.get<string>('WHATSAPP_ACCESS_TOKEN');
    const phoneNumberId = this.configService.get<string>(
      'WHATSAPP_PHONE_NUMBER_ID',
    );
    const version =
      this.configService.get<string>('WHATSAPP_VERSION') || 'v18.0';

    this.whatsappConfig = {
      accessToken: accessToken || '',
      phoneNumberId: phoneNumberId || '',
      version,
    };
  }

  async onModuleInit() {
    if (
      !this.whatsappConfig.accessToken ||
      !this.whatsappConfig.phoneNumberId
    ) {
      this.logger.warn(
        'WhatsApp credentials not configured. WhatsApp features will be disabled.',
      );
    } else {
      this.logger.log('WhatsApp service initialized', {
        phoneNumberId: this.whatsappConfig.phoneNumberId,
        version: this.whatsappConfig.version,
      });
    }
  }

  async sendMessage(
    phoneNumber: string,
    message: string,
    retryCount: number = 0,
  ): Promise<void> {
    if (!this.whatsappConfig.accessToken) {
      throw new Error('WhatsApp not configured: missing access token');
    }

    if (!this.whatsappConfig.phoneNumberId) {
      throw new Error('WhatsApp not configured: missing phoneNumberId');
    }

    const url = `https://graph.facebook.com/${this.whatsappConfig.version}/${this.whatsappConfig.phoneNumberId}/messages`;
    const data = {
      messaging_product: 'whatsapp',
      to: phoneNumber,
      type: 'text',
      text: { body: message },
    };

    try {
      this.logger.debug('Sending WhatsApp message', {
        phoneNumber: maskPhone(phoneNumber),
        messageLength: message.length,
        attempt: retryCount + 1,
      });

      const response = await ky.post(url, {
        json: data,
        headers: {
          Authorization: `Bearer ${this.whatsappConfig.accessToken}`,
          'Content-Type': 'application/json',
        },
        retry: { limit: 0 },
        throwHttpErrors: false,
      });

      if (!response.ok) {
        let errorMsg = `HTTP ${response.status}`;
        try {
          const errorBody = await response.json();
          const whatsappError = errorBody as WhatsAppErrorResponse;
          errorMsg = whatsappError.error?.message || errorMsg;
        } catch {
          // ignore parsing error
        }

        this.logger.warn('WhatsApp API error', {
          status: response.status,
          phoneNumber: maskPhone(phoneNumber),
          error: errorMsg,
        });

        if (this.shouldRetry(response.status, retryCount)) {
          const delay = this.calculateDelay(retryCount);
          this.logger.log(
            `Retrying in ${delay}ms (attempt ${retryCount + 1}/${this.MAX_RETRIES})`,
          );
          await this.sleep(delay);
          return this.sendMessage(phoneNumber, message, retryCount + 1);
        }

        throw new Error(`WhatsApp API error: ${errorMsg}`);
      }

      this.logger.debug('WhatsApp message sent successfully', {
        phoneNumber: maskPhone(phoneNumber),
      });
    } catch (error: any) {
      this.logger.error(
        `Failed to send WhatsApp message to ${hashIdentifier(phoneNumber)}: ${error.message}`,
        error.stack,
      );

      if (retryCount < this.MAX_RETRIES && this.isRetryableError(error)) {
        const delay = this.calculateDelay(retryCount);
        this.logger.log(`Retrying after error in ${delay}ms`);
        await this.sleep(delay);
        return this.sendMessage(phoneNumber, message, retryCount + 1);
      }

      throw error;
    }
  }

  async handleIncomingMessage(message: any): Promise<void> {
    const whatsappMessageId = message.id;
    const phoneNumber = message.from;
    const messageType = message.type || 'unknown';
    const textContent = this.messageService.extractTextFromMessage(message);
    const contentPreview = this.messageService.getContentPreview(textContent);

    this.logger.debug('Processing incoming message', {
      whatsappMessageId: hashIdentifier(whatsappMessageId),
      phoneNumber: maskPhone(phoneNumber),
      messageType,
      hasText: !!textContent,
    });

    const claimed =
      await this.messageService.markAsProcessing(whatsappMessageId);
    if (!claimed) {
      this.logger.warn(
        `Duplicate or already processing: ${hashIdentifier(whatsappMessageId)}`,
      );
      return;
    }

    if (messageType !== 'text') {
      const reply = this.getUnsupportedMessageReply(messageType);
      await this.sendMessage(phoneNumber, reply);
      await this.messageService.markAsSuccess(whatsappMessageId);
      return;
    }

    try {
      if (!textContent) {
        const reply = this.getUnsupportedMessageReply(messageType);
        await this.sendMessage(phoneNumber, reply);
        await this.messageService.markAsSuccess(whatsappMessageId);
        return;
      }

      const response = await this.ragService.askQuestion(textContent);

      await this.sendMessage(phoneNumber, response);

      await this.messageService.markAsSuccess(whatsappMessageId);

      this.logger.debug('Message processed successfully', {
        whatsappMessageId: hashIdentifier(whatsappMessageId),
      });
    } catch (error: any) {
      this.logger.error(
        `Failed to process message ${hashIdentifier(whatsappMessageId)}: ${error.message}`,
        error.stack,
      );

      const retryCount =
        await this.messageService.incrementRetryCount(whatsappMessageId);

      if (retryCount < 3 && this.isRetryableProcessingError(error)) {
        this.logger.log(`Message queued for retry (attempt ${retryCount})`);
      } else {
        await this.messageService.markAsFailed(
          whatsappMessageId,
          error.message,
        );
      }

      throw error;
    }
  }

  private getUnsupportedMessageReply(messageType: string): string {
    const responses: Record<string, string> = {
      image:
        'I can see you sent an image. Currently I only process text messages. Please type your legal question.',
      audio:
        'I received your audio message. Unfortunately I can only process text. Please type your question.',
      video:
        "I received your video. I'm designed to answer text-based legal questions only.",
      document: 'I received your document. Please send your question as text.',
      location:
        'I received your location. How can I help you with legal information?',
      contacts:
        'I received contact details. Please ask your legal question in text.',
      interactive:
        'I received an interactive element. Please type your question.',
    };
    return (
      responses[messageType] ||
      'I received your message but I can only process text. Please type your legal question.'
    );
  }

  private shouldRetry(statusCode: number, attempt: number): boolean {
    return attempt < this.MAX_RETRIES && this.isRetryableStatus(statusCode);
  }

  private isRetryableStatus(statusCode: number): boolean {
    return [429, 500, 502, 503, 504].includes(statusCode);
  }

  private isRetryableError(error: any): boolean {
    if (!error) return false;
    const errorMsg = error.message?.toLowerCase() || '';
    return (
      errorMsg.includes('timeout') ||
      errorMsg.includes('network') ||
      errorMsg.includes('econnreset') ||
      errorMsg.includes('rate limit') ||
      errorMsg.includes('too many requests')
    );
  }

  private isRetryableProcessingError(error: any): boolean {
    if (!error) return false;
    const errorMsg = error.message?.toLowerCase() || '';
    return (
      errorMsg.includes('timeout') ||
      errorMsg.includes('network') ||
      errorMsg.includes('database') ||
      errorMsg.includes('unavailable') ||
      errorMsg.includes('internal server error')
    );
  }

  private calculateDelay(attempt: number): number {
    const exponentialDelay = this.BASE_DELAY_MS * Math.pow(2, attempt);
    const jitter = Math.random() * 1000;
    return Math.min(exponentialDelay + jitter, 30000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
