import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';

export enum ProcessingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCESS = 'success',
  FAILED = 'failed',
  RETRYING = 'retrying',
}

interface WhatsAppMessageRecord {
  id: string;
  whatsappMessageId: string;
  phoneNumber: string;
  messageType: string;
  contentPreview: string | null;
  processingStatus: string;
  errorMessage: string | null;
  retryCount: number;
  createdAt: Date;
  processedAt: Date | null;
}

@Injectable()
export class WhatsAppMessageService {
  private readonly logger = new Logger(WhatsAppMessageService.name);

  constructor(private prisma: PrismaService) {}

  async isDuplicate(whatsappMessageId: string): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "WhatsAppMessage" 
        WHERE "whatsappMessageId" = ${whatsappMessageId}
        LIMIT 1
      `;
      return rows.length > 0;
    } catch (error: any) {
      this.logger.error(`Error checking duplicate: ${error.message}`);
      return false;
    }
  }

  async createMessageRecord(
    whatsappMessageId: string,
    phoneNumber: string,
    messageType: string,
    contentPreview?: string,
  ): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO "WhatsAppMessage" ("whatsappMessageId", "phoneNumber", "messageType", "contentPreview", "processingStatus")
        VALUES (${whatsappMessageId}, ${phoneNumber}, ${messageType}, ${contentPreview || null}, 'pending')
        ON CONFLICT ("whatsappMessageId") DO NOTHING
      `;
      this.logger.debug('Created message record', {
        whatsappMessageId,
        phoneNumber,
        messageType,
      });
    } catch (error: any) {
      this.logger.error(`Failed to create message record: ${error.message}`);
      throw error;
    }
  }

  async markAsProcessing(whatsappMessageId: string): Promise<boolean> {
    try {
      const result = await this.prisma.$executeRaw`
        UPDATE "WhatsAppMessage" 
        SET "processingStatus" = 'processing', "processedAt" = NOW()
        WHERE "whatsappMessageId" = ${whatsappMessageId} 
        AND "processingStatus" = 'pending'
      `;
      return result > 0;
    } catch (error: any) {
      this.logger.error(`Failed to mark as processing: ${error.message}`);
      return false;
    }
  }

  async markAsSuccess(whatsappMessageId: string): Promise<boolean> {
    try {
      const result = await this.prisma.$executeRaw`
        UPDATE "WhatsAppMessage" 
        SET "processingStatus" = 'success', "processedAt" = NOW()
        WHERE "whatsappMessageId" = ${whatsappMessageId}
      `;
      return result > 0;
    } catch (error: any) {
      this.logger.error(`Failed to mark as success: ${error.message}`);
      return false;
    }
  }

  async markAsFailed(
    whatsappMessageId: string,
    errorMessage: string,
  ): Promise<boolean> {
    try {
      const result = await this.prisma.$executeRaw`
        UPDATE "WhatsAppMessage" 
        SET "processingStatus" = 'failed', "errorMessage" = ${errorMessage}, "processedAt" = NOW()
        WHERE "whatsappMessageId" = ${whatsappMessageId}
      `;
      return result > 0;
    } catch (error: any) {
      this.logger.error(`Failed to mark as failed: ${error.message}`);
      return false;
    }
  }

  async incrementRetryCount(whatsappMessageId: string): Promise<number> {
    try {
      await this.prisma.$executeRaw`
        UPDATE "WhatsAppMessage" 
        SET "retryCount" = "retryCount" + 1, "processingStatus" = 'retrying'
        WHERE "whatsappMessageId" = ${whatsappMessageId}
      `;
      const record = await this.getByWhatsAppId(whatsappMessageId);
      return record?.retryCount || 1;
    } catch (error: any) {
      this.logger.error(`Failed to increment retry count: ${error.message}`);
      return 1;
    }
  }

  private async getByWhatsAppId(
    whatsappMessageId: string,
  ): Promise<WhatsAppMessageRecord | null> {
    const rows = await this.prisma.$queryRaw<Array<WhatsAppMessageRecord>>`
      SELECT * FROM "WhatsAppMessage" 
      WHERE "whatsappMessageId" = ${whatsappMessageId}
      LIMIT 1
    `;
    return rows[0] || null;
  }

  extractTextFromMessage(message: any): string | null {
    if (!message) return null;

    switch (message.type) {
      case 'text':
        return message.text?.body || null;
      case 'image':
        return message.image?.caption || null;
      case 'video':
        return message.video?.caption || null;
      case 'document':
        return message.document?.filename || null;
      case 'audio':
        return '[Audio message]';
      case 'location':
        return `[Location: ${message.location?.latitude}, ${message.location?.longitude}]`;
      default:
        return `[Unsupported message type: ${message.type}]`;
    }
  }

  getMessageType(message: any): string {
    return message?.type || 'unknown';
  }

  getContentPreview(text: string | null, maxLength: number = 100): string {
    if (!text) return '';
    return text.length > maxLength
      ? text.substring(0, maxLength) + '...'
      : text;
  }
}
