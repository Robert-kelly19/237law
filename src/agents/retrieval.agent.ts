import {BaseRetriever} from '@voltagent/core';

export class RetrievalAgent extends BaseRetriever {
  constructor() {
    super();
  }

  
  async searchRelevantSections(query: string): Promise<LawSectionResult[]> {
    const embedding = await this.embeddingService.generateQueryEmbedding(query);
    const vector = this.vectorToLiteral(embedding);

    const results = await this.prisma.$queryRaw`
      SELECT id,"lawName","articleNumber",content,source,
      embedding <=> ${vector}::vector(1536) AS distance
      FROM law_sections
      ORDER BY embedding <=> ${vector}::vector(1536)
      LIMIT 5
    `;

    return results as LawSectionResult[];
  }
}