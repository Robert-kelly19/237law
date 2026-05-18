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
import { MemoryService } from './memory/memory.service';
import { ConversationService } from './memory/conversation.service';
import { LawSearchTool } from './agents/tools/law-search.tool';
import { CitationTool } from './agents/tools/citation.tool';
import { ContextTool } from './agents/tools/context.tool';
import { LegalAgentService } from './agents/legal.agent';

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
    MemoryService,
    ConversationService,
    LawSearchTool,
    CitationTool,
    ContextTool,
    LegalAgentService,
  ],
})
export class AppModule {}
