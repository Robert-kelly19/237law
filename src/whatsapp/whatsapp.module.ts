import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { WhatsAppMessageService } from './whatsapp-message.service';
import { PrismaService } from 'src/prisma.service';
import { ConfigModule } from '@nestjs/config';
import { RagModule } from '../rag.module';

@Module({
  imports: [ConfigModule, RagModule],
  controllers: [WhatsappController],
  providers: [WhatsappService, WhatsAppMessageService, PrismaService],
})
export class WhatsAppModule {}
