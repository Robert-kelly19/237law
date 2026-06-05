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
import { LawSearchTool } from './agents/tools/law-search.tool';
import { CitationTool } from './agents/tools/citation.tool';
import { MemoryService } from './memory/memory.service';
import { ConversationService } from './memory/conversation.service';
import { ConfigModule } from '@nestjs/config';
import { LegalAgentService } from './agents/legal.agent';
import { ContextTool } from './agents/tools/context.tool';
import { EmbeddingCacheService } from './cache/embedding-cache.service';
import { LLMResponseCacheService } from './cache/llm-response-cache.service';
import { PerformanceTrackerService } from './performance/performance-tracker.service';
import { CommonModule } from './common/common.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CommonModule,
  ],
  controllers: [AppController, RagController, WhatsappController],
  providers: [
    AppService,
    PrismaService,
    PdfService,
    EmbeddingService,
    RagService,
    WhatsappService,
    LegalAgentService,
    LawSearchTool,
    CitationTool,
    ContextTool,
    MemoryService,
    ConversationService,
    EmbeddingCacheService,
    LLMResponseCacheService,
    PerformanceTrackerService,
  ],
})
export class AppModule {}
