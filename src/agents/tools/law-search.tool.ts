import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { EmbeddingService } from '../../embedding.service';
import { PerformanceTrackerService } from '../../performance/performance-tracker.service';

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
  score?: number;
}

export interface LawSearchOptions {
  sources?: string[];
  minSimilarity?: number;
}

@Injectable()
export class LawSearchTool {
  private readonly logger = new Logger(LawSearchTool.name);

  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
    private performanceTracker: PerformanceTrackerService,
  ) {}

  /**
   * Search law sections by keyword with performance tracking
   */
  async searchByKeyword(
    query: string,
    limit: number = 5,
    options?: LawSearchOptions,
  ): Promise<ToolResult> {
    return this.performanceTracker.track('searchByKeyword', async () => {
      try {
        this.logger.debug(`Searching by keyword: ${query} (limit: ${limit})`);
        const sourceFilter = this.buildSourceFilter(options?.sources);

        // Full-text search using PostgreSQL
        const results = await this.prisma.$queryRaw<LawSearchResult[]>`
            SELECT 
              id,
              "lawName",
              "articleNumber",
              content,
              source,
              ts_rank(
                to_tsvector('english', content || ' ' || "lawName" || ' ' || "articleNumber"),
                plainto_tsquery('english', ${query})
              ) as score
            FROM law_sections
            WHERE 
              (
                to_tsvector('english', content) @@ plainto_tsquery('english', ${query})
                OR to_tsvector('english', "lawName") @@ plainto_tsquery('english', ${query})
                OR to_tsvector('english', "articleNumber") @@ plainto_tsquery('english', ${query})
              )
              ${sourceFilter}
            ORDER BY score DESC
            LIMIT ${limit}
          `;

        return {
          success: true,
          data: results,
          reasoning: `Found ${results.length} law sections matching keyword "${query}"`,
        };
      } catch (error: any) {
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
    });
  }

  /**
   * Search law sections by semantic similarity with performance tracking
   */
  async searchByTopic(
    topic: string,
    limit: number = 5,
    options?: LawSearchOptions,
  ): Promise<ToolResult> {
    return this.performanceTracker.track('searchByTopic', async () => {
      try {
        this.logger.debug(`Searching by topic: ${topic} (limit: ${limit})`);
        const sourceFilter = this.buildSourceFilter(options?.sources);
        const candidateLimit = Math.max(limit * 3, limit);

        // Generate embedding for the topic (with caching)
        const topicEmbedding =
          await this.embeddingService.generateQueryEmbedding(topic);

        // Vector similarity search using PostgreSQL with HNSW index
        const results = await this.prisma.$queryRaw<any[]>`
            SELECT 
              id,
              "lawName",
              "articleNumber",
              content,
              source,
              1 - (embedding <=> ${`[${topicEmbedding.join(',')}]`}::vector) as distance
            FROM law_sections
            WHERE 1 = 1
            ${sourceFilter}
            ORDER BY embedding <=> ${`[${topicEmbedding.join(',')}]`}::vector
            LIMIT ${candidateLimit}
          `;

        const minSimilarity = options?.minSimilarity ?? 0;
        const relevantResults = results
          .filter((result) => Number(result.distance) >= minSimilarity)
          .slice(0, limit);

        return {
          success: true,
          data: relevantResults,
          reasoning: `Found ${relevantResults.length} law sections semantically similar to "${topic}"`,
        };
      } catch (error: any) {
        this.logger.error(`Topic search failed: ${error.message}`, error.stack);
        return {
          success: false,
          data: [],
          reasoning: `Topic search failed: ${error.message}`,
        };
      }
    });
  }

  private buildSourceFilter(sources?: string[]): Prisma.Sql {
    if (!sources?.length) {
      return Prisma.empty;
    }

    const sourceClauses = sources.map(
      (source) => Prisma.sql`source = ${source}`,
    );
    return Prisma.sql`AND (${Prisma.join(sourceClauses, ' OR ')})`;
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
    } catch (error: any) {
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
      this.logger.debug(`Getting cross-references for article: ${articleId}`);

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
    } catch (error: any) {
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
    } catch (error: any) {
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
