import { Controller, Body, Get, Post, Query } from '@nestjs/common';
import { RagService } from './rag.service';

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  /**
   * Endpoint to search for relevant sections.
   */
  @Get('search')
  async search(@Query('query') query: string) {
    const results = await this.ragService.searchRelevantSections(query);
    return results;
  }

  /**
   * Endpoint to ask a question using RAG.
   */
  @Post('ask')
  async ask(@Body() body: { query: string }) {
    const answer = await this.ragService.askQuestion(body.query);
    return { answer };
  }
}