import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { EmbeddingService } from '../../embedding.service';

export interface ToolResult {
  success: boolean;
  data: any;
  reasoning: string;
}

export interface LawSearchResult {
  id: string;
  lawName: string;
  articleNumber: string;
  content: string;
  source: string;
  distance?: number;
}

@Injectable()
export class LawSearchTool {
  private readonly logger = new Logger(LawSearchTool.name);

  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
  ) {}

  /**
   * Search law sections by keyword
   */
  async searchByKeyword(
    query: string,
    limit: number = 5,
  ): Promise<ToolResult> {
    try {
      this.logger.debug(`Searching by keyword: ${query} (limit: ${limit})`);

      // Full-text search using PostgreSQL
      const results = await this.prisma.$queryRaw<LawSearchResult[]>`
        SELECT 
          id,
          "lawName",
          "articleNumber",
          content,
          source
        FROM law_sections
        WHERE 
          to_tsvector('english', content) @@ plainto_tsquery('english', ${query})
          OR to_tsvector('english', "lawName") @@ plainto_tsquery('english', ${query})
          OR to_tsvector('english', "articleNumber") @@ plainto_tsquery('english', ${query})
        LIMIT ${limit}
      `;

      return {
        success: true,
        data: results,
        reasoning: `Found ${results.length} law sections matching keyword "${query}"`,
      };
    } catch (error) {
      this.logger.error(
        `Keyword search failed: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        data: [],
        reasoning: `Keyword search failed: ${error.message}`,
      };
    }
  }

  /**
   * Search law sections by semantic similarity
   */
  async searchByTopic(topic: string, limit: number = 5): Promise<ToolResult> {
    try {
      this.logger.debug(`Searching by topic: ${topic} (limit: ${limit})`);

      // Generate embedding for the topic
      const topicEmbedding = await this.embeddingService.generateQueryEmbedding(
        topic,
      );

      // Vector similarity search using PostgreSQL
      const results = await this.prisma.$queryRaw<any[]>`
        SELECT 
          id,
          "lawName",
          "articleNumber",
          content,
          source,
          1 - (embedding <=> ${`[${topicEmbedding.join(',')}]`}::vector) as distance
        FROM law_sections
        ORDER BY embedding <=> ${`[${topicEmbedding.join(',')}]`}::vector
        LIMIT ${limit}
      `;

      return {
        success: true,
        data: results,
        reasoning: `Found ${results.length} law sections semantically similar to "${topic}"`,
      };
    } catch (error) {
      this.logger.error(
        `Topic search failed: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        data: [],
        reasoning: `Topic search failed: ${error.message}`,
      };
    }
  }

  /**
   * Get a specific article by ID
   */
  async getArticleById(articleId: string): Promise<ToolResult> {
    try {
      this.logger.debug(`Fetching article: ${articleId}`);

      const article = await this.prisma.lawSection.findUnique({
        where: { id: articleId },
      });

      if (!article) {
        return {
          success: false,
          data: null,
          reasoning: `Article not found: ${articleId}`,
        };
      }

      return {
        success: true,
        data: article,
        reasoning: `Successfully retrieved article ${article.lawName} Article ${article.articleNumber}`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch article: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        data: null,
        reasoning: `Failed to fetch article: ${error.message}`,
      };
    }
  }

  /**
   * Get cross-references (related articles)
   */
  async getCrossReferences(
    articleId: string,
    limit: number = 5,
  ): Promise<ToolResult> {
    try {
      this.logger.debug(
        `Getting cross-references for article: ${articleId}`,
      );

      // Get the original article
      const article = await this.prisma.lawSection.findUnique({
        where: { id: articleId },
      });

      if (!article) {
        return {
          success: false,
          data: [],
          reasoning: `Article not found: ${articleId}`,
        };
      }

      // Find related articles by searching for similar content
      const relatedArticles = await this.prisma.$queryRaw<any[]>`
        SELECT 
          id,
          "lawName",
          "articleNumber",
          content,
          source,
          1 - (embedding <=> (
            SELECT embedding FROM law_sections WHERE id = ${articleId}
          )) as similarity
        FROM law_sections
        WHERE id != ${articleId}
        ORDER BY embedding <=> (
          SELECT embedding FROM law_sections WHERE id = ${articleId}
        )
        LIMIT ${limit}
      `;

      return {
        success: true,
        data: relatedArticles,
        reasoning: `Found ${relatedArticles.length} related articles to ${article.lawName} Article ${article.articleNumber}`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get cross-references: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        data: [],
        reasoning: `Failed to get cross-references: ${error.message}`,
      };
    }
  }

  /**
   * Search by law name and article number
   */
  async searchByLawAndArticle(
    lawName: string,
    articleNumber?: string,
  ): Promise<ToolResult> {
    try {
      this.logger.debug(
        `Searching by law: ${lawName}, article: ${articleNumber}`,
      );

      const where: any = {
        lawName: {
          contains: lawName,
          mode: 'insensitive',
        },
      };

      if (articleNumber) {
        where.articleNumber = {
          contains: articleNumber,
          mode: 'insensitive',
        };
      }

      const results = await this.prisma.lawSection.findMany({
        where,
        take: 10,
      });

      return {
        success: true,
        data: results,
        reasoning: `Found ${results.length} sections of ${lawName}${articleNumber ? ` Article ${articleNumber}` : ''}`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to search by law/article: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        data: [],
        reasoning: `Failed to search by law/article: ${error.message}`,
      };
    }
  }
}
