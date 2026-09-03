import { Module } from '@nestjs/common';
import { EmbeddingCacheService } from '../cache/embedding-cache.service';
import { LLMResponseCacheService } from '../cache/llm-response-cache.service';
import { CommonModule } from '../common/common.module';
import { EmbeddingService } from '../embedding.service';
import { MemoryModule } from '../memory/memory.module';
import { PerformanceTrackerService } from '../performance/performance-tracker.service';
import { LegalAgentService } from './legal.agent';
import { CitationTool } from './tools/citation.tool';
import { ContextTool } from './tools/context.tool';
import { LawSearchTool } from './tools/law-search.tool';

@Module({
  imports: [CommonModule, MemoryModule],
  providers: [
    LegalAgentService,
    LawSearchTool,
    CitationTool,
    ContextTool,
    EmbeddingService,
    EmbeddingCacheService,
    LLMResponseCacheService,
    PerformanceTrackerService,
  ],
  exports: [LegalAgentService, EmbeddingService, PerformanceTrackerService],
})
export class AgentsModule {}
