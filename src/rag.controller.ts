import { Controller, Body, Get, Post, Query, Logger, BadRequestException } from '@nestjs/common';
import { RagService } from './rag.service';
import { AskQueryDto, SearchQueryDto } from './rag-query.dto';
import { LegalAgentService } from './agents/legal.agent';

@Controller('rag')
export class RagController {
  private readonly logger = new Logger(RagController.name);

  constructor(
    private readonly ragService: RagService,
    private readonly legalAgent: LegalAgentService,
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
    } catch (error:any) {
      this.logger.error(`Agent processing error: ${error.message}`, error.stack);
      throw error;
    }
  }
}
