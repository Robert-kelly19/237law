import { Controller, Body, Get, Post, Query } from '@nestjs/common';
import { RagService } from './rag.service';
import { AskQueryDto, SearchQueryDto } from './rag-query.dto';

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  /**
   * Endpoint to search for relevant sections.
   */
  @Get('search')
  async search(@Query() searchDto: SearchQueryDto) {
    const results = await this.ragService.searchRelevantSections(searchDto.query);
    return results;
  }

  /**
   * Endpoint to ask a question using RAG.
   */
  @Post('ask')
  async ask(@Body() askDto: AskQueryDto) {
    const answer = await this.ragService.askQuestion(askDto.query);
    return { answer };
  }
}