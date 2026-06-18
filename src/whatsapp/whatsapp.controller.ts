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
  OnModuleDestroy,
} from '@nestjs/common';
import type { Response } from 'express';
import { LanguageDetectionService } from '../common/language-detection.service';
import { WhatsappService } from './whatsapp.service';
import { LegalAgentService } from '../agents/legal.agent';
import { ConversationService } from '../memory/conversation.service';

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
export class WhatsappController implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsappController.name);

  /**
   * Track processed message IDs to prevent duplicate webhook processing
   * Key: WhatsApp message ID, Value: timestamp when processed
   */
  private readonly processedMessages = new Map<string, number>();

  /**
   * Time-to-live for message deduplication (5 minutes)
   */
  private readonly MESSAGE_TTL = 300000;

  /**
   * Interval to cleanup old message entries (every minute)
   */
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Buffer for pending greeting messages to detect greeting→question pattern
   * Key: userId, Value: { text, messageId, timestamp, timeoutId }
   */
  private readonly pendingGreetings = new Map<
    string,
    {
      text: string;
      messageId: string;
      timestamp: number;
      timeoutId: NodeJS.Timeout;
    }
  >();

  /**
   * Delay to wait for follow-up after greeting (milliseconds)
   */
  private readonly GREETING_BUFFER_DELAY = 3000;

  constructor(
    private whatsappService: WhatsappService,
    private legalAgent: LegalAgentService,
    private languageDetection: LanguageDetectionService,
    private conversationService: ConversationService,
  ) {
    // Start background cleanup task
    this.startCleanupTask();
  }

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
          const messageId = message.id;
          const from = message.from;
          const text = message.text?.body;

          if (!from || !text) continue;

          if (!messageId) {
            this.logger.warn(
              `Skipping message from ${from} with text "${text?.substring(0, 50)}": missing message.id`,
            );
            continue;
          }

          // Check if this message has already been processed (idempotency)
          if (this.isMessageProcessed(messageId)) {
            this.logger.warn(
              `Duplicate webhook detected for message ${messageId}, skipping`,
            );
            continue;
          }

          // Mark message as processed before processing to prevent race conditions
          this.markMessageAsProcessed(messageId);

          // NEW: Implement message buffering for greeting→question detection
          try {
            await this.whatsappService.sendTypingIndicator(from);
            await this.processMessageWithBuffering(from, text, messageId);
          } catch (err: any) {
            this.logger.error(
              `Error processing message: ${err instanceof Error ? err.message : String(err)}`,
              err instanceof Error ? err.stack : undefined,
            );
            try {
              await this.whatsappService.send(
                from,
                'Something went wrong. Try again later.',
              );
            } catch (sendErr) {
              this.logger.error(
                `Fallback message also failed: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`,
                sendErr instanceof Error ? sendErr.stack : undefined,
              );
            }
          }
        }
      }
    }

    return { status: 'EVENT_RECEIVED' };
  }

  /**
   * Check if a message has already been processed
   */
  private isMessageProcessed(messageId: string | undefined): boolean {
    if (!messageId) return false;
    return this.processedMessages.has(messageId);
  }

  /**
   * Mark a message as processed with current timestamp
   */
  private markMessageAsProcessed(messageId: string | undefined): void {
    if (messageId) {
      this.processedMessages.set(messageId, Date.now());
    }
  }

  /**
   * Process a message with greeting buffering to detect greeting→question pattern
   * NEW: Implements message buffering and context-aware greeting detection
   */
  private async processMessageWithBuffering(
    from: string,
    text: string,
    messageId: string,
  ): Promise<void> {
    const isGreetingOnly = this.languageDetection.isGreetingOnly(text);
    const hasLegalIntent = this.languageDetection.hasLegalIntent(text);

    this.logger.debug(
      `Message from ${from}: greeting=${isGreetingOnly}, hasLegalIntent=${hasLegalIntent}`,
    );

    if (isGreetingOnly && !hasLegalIntent) {
      // This is a pure greeting - buffer it to wait for follow-up legal question
      const existingPending = this.pendingGreetings.get(from);

      // Clear previous pending greeting if exists
      if (existingPending) {
        clearTimeout(existingPending.timeoutId);
        this.logger.debug(`Cleared previous pending greeting for ${from}`);
      }

      // Buffer this greeting with a timeout
      const timeoutId = setTimeout(async () => {
        this.pendingGreetings.delete(from);
        this.logger.debug(
          `Greeting buffer timeout for ${from}, sending greeting response`,
        );

        // Send the greeting response after waiting for follow-up
        try {
          const sessionId =
            await this.conversationService.getOrCreateSession(from);
          const response = await this.legalAgent.processQuery({
            userId: from,
            sessionId,
            query: text,
          });

          this.logger.log(`Generated response: ${response.answer}`);
          await this.whatsappService.send(from, response.answer);
        } catch (err: any) {
          this.logger.error(
            `Error processing buffered greeting: ${err instanceof Error ? err.message : String(err)}`,
            err instanceof Error ? err.stack : undefined,
          );
        }
      }, this.GREETING_BUFFER_DELAY);

      // Store pending greeting
      this.pendingGreetings.set(from, {
        text,
        messageId,
        timestamp: Date.now(),
        timeoutId,
      });

      this.logger.debug(
        `Buffered greeting from ${from}, waiting for follow-up...`,
      );
      return;
    }

    // Check if there's a pending greeting for this user
    const pendingGreeting = this.pendingGreetings.get(from);
    if (pendingGreeting) {
      // Clear the pending greeting buffer
      clearTimeout(pendingGreeting.timeoutId);
      this.pendingGreetings.delete(from);

      this.logger.debug(
        `Greeting→Question pattern detected for ${from}, skipping greeting and responding to legal query`,
      );
    }

    // Process the message normally through the agent
    try {
      const sessionId = await this.conversationService.getOrCreateSession(from);
      const response = await this.legalAgent.processQuery({
        userId: from,
        sessionId,
        query: text,
      });

      this.logger.log(`Generated response: ${response.answer}`);
      await this.whatsappService.send(from, response.answer);
    } catch (err: any) {
      this.logger.error(
        `Agent processing error: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  /**
   * Start background cleanup task to remove old message entries
   */
  private startCleanupTask(): void {
    // Run cleanup every 60 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldMessages();
    }, 60000);

    // Ensure interval doesn't prevent process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Remove message IDs older than MESSAGE_TTL from the processed messages map
   */
  private cleanupOldMessages(): void {
    const now = Date.now();
    let removedCount = 0;

    for (const [messageId, timestamp] of this.processedMessages.entries()) {
      if (now - timestamp > this.MESSAGE_TTL) {
        this.processedMessages.delete(messageId);
        removedCount++;
      }
    }

    // Also cleanup old pending greetings (older than 5 seconds)
    for (const [userId, pending] of this.pendingGreetings.entries()) {
      if (now - pending.timestamp > 5000) {
        clearTimeout(pending.timeoutId);
        this.pendingGreetings.delete(userId);
        this.logger.debug(`Cleaned up stale pending greeting for ${userId}`);
      }
    }

    if (removedCount > 0) {
      this.logger.debug(
        `Cleaned up ${removedCount} old messages. Map size: ${this.processedMessages.size}`,
      );
    }
  }

  /**
   * Cleanup task on controller destruction
   */
  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Clear all pending greetings
    for (const pending of this.pendingGreetings.values()) {
      clearTimeout(pending.timeoutId);
    }
    this.pendingGreetings.clear();
  }
}
