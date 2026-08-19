import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PdfService } from './pdf.service';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';
import { WhatsappController } from './whatsapp/whatsapp.controller';
import { WhatsappService } from './whatsapp/whatsapp.service';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { SmsModule } from './sms/sms.module';
import { AgentsModule } from './agents/agents.module';
import { MemoryModule } from './memory/memory.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CommonModule,
    AgentsModule,
    MemoryModule,
    SmsModule,
  ],
  controllers: [AppController, RagController, WhatsappController],
  providers: [AppService, PdfService, RagService, WhatsappService],
})
export class AppModule {}
