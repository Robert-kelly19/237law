import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { PdfService } from './pdf.service';
import { EmbeddingService } from './embedding.service';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';
import { WhatsappController } from './whatsapp/whatsapp.controller';
import { WhatsappService } from './whatsapp/whatsapp.service';
import { ConfigModule } from '@nestjs/config';
import { createRagAgent } from './agent/rag.agent';
import { Agent } from '@voltagent/core';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [AppController, RagController, WhatsappController],
  providers: [
    AppService,
    PrismaService,
    PdfService,
    EmbeddingService,
    RagService,
    WhatsappService,
    {
      provide: 'RAG_AGENT',
      useFactory: (ragService: RagService): Agent => {
        return createRagAgent(ragService);
      },
      inject: [RagService],
    },
  ],
})
export class AppModule {}
