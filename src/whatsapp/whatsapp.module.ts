import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { WhatsAppMessageService } from './whatsapp-message.service';
import { WhatsAppQueueService } from './whatsapp-queue.service';
import { PrismaModule } from '../prisma.module';
import { ConfigModule } from '@nestjs/config';
import { RagModule } from '../rag.module';

@Module({
  imports: [ConfigModule, RagModule, PrismaModule],
  controllers: [WhatsappController],
  providers: [WhatsappService, WhatsAppMessageService, WhatsAppQueueService],
})
export class WhatsAppModule {}
