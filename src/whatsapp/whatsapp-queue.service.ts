import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma.service';
import { WhatsappService } from './whatsapp.service';
import { WhatsAppMessageService } from './whatsapp-message.service';

interface PendingMessage {
  id: string;
  whatsappMessageId: string;
  phoneNumber: string;
  messageType: string;
  processingStatus: string;
  retryCount: number;
}

@Injectable()
export class WhatsAppQueueService {
  private readonly logger = new Logger(WhatsAppQueueService.name);
  private readonly MAX_RETRIES = 3;
  private readonly BATCH_SIZE = 10;
  private isProcessing = false;

  constructor(
    private prisma: PrismaService,
    private whatsappService: WhatsappService,
    private messageService: WhatsAppMessageService,
  ) {}

  /**
   * Process pending and failed messages every 30 seconds
   */
  @Cron('*/30 * * * * *')
  async processPendingMessages(): Promise<void> {
    if (this.isProcessing) {
      this.logger.debug('Already processing, skipping this cycle');
      return;
    }

    this.isProcessing = true;
    try {
      await this.processMessages();
      await this.retryFailedMessages();
    } catch (error) {
      const err = error as unknown;
      if (err instanceof Error) {
        this.logger.error(
          `Error in message processing cycle: ${err.message}`,
          err.stack,
        );
      } else {
        this.logger.error(`Error in message processing cycle: ${String(err)}`);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async processMessages(): Promise<void> {
    const messages = await this.getPendingMessages();

    if (messages.length === 0) {
      return;
    }

    this.logger.debug(`Processing ${messages.length} pending messages`);

    for (const message of messages) {
      try {
        const claimed = await this.messageService.markAsProcessing(
          message.whatsappMessageId,
        );

        if (!claimed) {
          this.logger.debug(
            `Message ${message.whatsappMessageId} already being processed`,
          );
          continue;
        }

        await this.whatsappService.handleIncomingMessage({
          id: message.whatsappMessageId,
          from: message.phoneNumber,
          type: message.messageType,
        });

        this.logger.debug(`Processed message ${message.whatsappMessageId}`);
      } catch (error) {
        const err = error as unknown;
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Failed to process message ${message.whatsappMessageId}: ${errorMsg}`,
        );

        // Increment retry count and mark for retry
        const retryCount = await this.messageService.incrementRetryCount(
          message.whatsappMessageId,
        );

        if (retryCount >= this.MAX_RETRIES) {
          await this.messageService.markAsFailed(
            message.whatsappMessageId,
            errorMsg,
          );
          this.logger.warn(
            `Message ${message.whatsappMessageId} exceeded max retries`,
          );
        }
      }
    }
  }

  private async retryFailedMessages(): Promise<void> {
    const messages = await this.getRetryingMessages();

    if (messages.length === 0) {
      return;
    }

    this.logger.debug(`Retrying ${messages.length} messages`);

    for (const message of messages) {
      if (message.retryCount >= this.MAX_RETRIES) {
        await this.messageService.markAsFailed(
          message.whatsappMessageId,
          'Max retries exceeded',
        );
        continue;
      }

      try {
        const claimed = await this.messageService.markAsProcessing(
          message.whatsappMessageId,
        );

        if (!claimed) {
          this.logger.debug(
            `Message ${message.whatsappMessageId} already being processed`,
          );
          continue;
        }

        await this.whatsappService.handleIncomingMessage({
          id: message.whatsappMessageId,
          from: message.phoneNumber,
          type: message.messageType,
        });

        this.logger.debug(`Retried message ${message.whatsappMessageId}`);
      } catch (error) {
        const err = error as unknown;
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Retry failed for message ${message.whatsappMessageId}: ${errorMsg}`,
        );
      }
    }
  }

  private async getPendingMessages(): Promise<PendingMessage[]> {
    try {
      const messages = await this.prisma.$queryRaw<PendingMessage[]>`
        SELECT id, "whatsappMessageId", "phoneNumber", "messageType", "processingStatus", "retryCount"
        FROM whatsapp_messages
        WHERE "processingStatus" = 'PENDING'
        ORDER BY "createdAt" ASC
        LIMIT ${this.BATCH_SIZE}
      `;
      return messages;
    } catch (error) {
      const err = error as unknown;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to fetch pending messages: ${errorMsg}`);
      return [];
    }
  }

  private async getRetryingMessages(): Promise<PendingMessage[]> {
    try {
      const messages = await this.prisma.$queryRaw<PendingMessage[]>`
        SELECT id, "whatsappMessageId", "phoneNumber", "messageType", "processingStatus", "retryCount"
        FROM whatsapp_messages
        WHERE "processingStatus" = 'RETRYING'
        ORDER BY "processedAt" ASC
        LIMIT ${this.BATCH_SIZE}
      `;
      return messages;
    } catch (error) {
      const err = error as unknown;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to fetch retrying messages: ${errorMsg}`);
      return [];
    }
  }
}
