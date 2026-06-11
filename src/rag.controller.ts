import {
  Controller,
  Body,
  Get,
  Post,
  Query,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { RagService } from './rag.service';
import { AskQueryDto, SearchQueryDto } from './rag-query.dto';
import { LegalAgentService } from './agents/legal.agent';
import { LLMResponseCacheService } from './cache/llm-response-cache.service';

@Controller('rag')
export class RagController {
  private readonly logger = new Logger(RagController.name);

  constructor(
    private readonly ragService: RagService,
    private readonly legalAgent: LegalAgentService,
    private readonly llmCacheService: LLMResponseCacheService,
  ) {}

  /**
   * Endpoint to search for relevant sections.
   */
  @Get('search')
  async search(@Query() searchDto: SearchQueryDto) {
    const results = await this.ragService.searchRelevantSections(
      searchDto.query,
    );
    return results;
  }

  /**
   * Endpoint to ask a question using RAG (legacy).
   */
  @Post('ask')
  async ask(@Body() askDto: AskQueryDto) {
    const answer = await this.ragService.askQuestion(askDto.query);
    return { answer };
  }

  /**
   * Clear cached LLM answers after retrieval or prompt changes.
   */
  @Post('cache/clear')
  clearCache() {
    this.llmCacheService.clear();
    return { success: true, message: 'LLM cache cleared' };
  }

  /**
   * Endpoint to ask a question using the intelligent agent with memory.
   * Supports multi-turn conversations with context awareness.
   */
  @Post('ask-agent')
  async askWithAgent(@Body() askDto: AskQueryDto) {
    // Validate required parameters
    if (!askDto.userId) {
      throw new BadRequestException(
        'userId is required for agent-based queries',
      );
    }

    try {
      this.logger.debug(
        `Agent query from user ${askDto.userId}: ${askDto.query}`,
      );

      const response = await this.legalAgent.processQuery({
        userId: askDto.userId,
        sessionId: askDto.sessionId,
        query: askDto.query,
      });

      return {
        success: true,
        data: response,
      };
    } catch (error: any) {
      this.logger.error(
        `Agent processing error: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Manual trigger to re-ingest all PDFs (for testing/debugging).
   * Accepts an optional body.force flag; when true, it forces re-ingestion of
   * already-ingested sources by overriding the normal dedup/skip logic. When
   * omitted or false, already-ingested sources are skipped.
   */
  private readonly reingestLock = { running: false };

  @Post('reingest-all')
  async reingestAll(@Body() body?: { force?: boolean }) {
    if (this.reingestLock.running) {
      return { success: false, message: 'Ingestion already running' };
    }
    this.reingestLock.running = true;
    try {
      this.logger.log('Manual re-ingestion triggered');
      const result = await this.ragService.ingestPdfs(Boolean(body?.force));
      return {
        success: true,
        ingested: result.ingested,
        skipped: result.skipped,
        failed: result.failed,
      };
    } finally {
      this.reingestLock.running = false;
    }
  }

  /**
   * Check database ingestion status
   */
  @Get('ingest-status')
  async getIngestionStatus() {
    return this.ragService.getIngestionStatus();
  }
}
