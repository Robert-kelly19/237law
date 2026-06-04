import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { EmbeddingCacheService } from './cache/embedding-cache.service';
import { PerformanceTrackerService } from './performance/performance-tracker.service';

@Injectable()
export class EmbeddingService {
  private openai: OpenAI;
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    private cacheService: EmbeddingCacheService,
    private performanceTracker: PerformanceTrackerService,
  ) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY, // Ensure this is set in environment
    });
  }

  isValidChunk(text: unknown): text is string {
    return this.getChunkValidationReason(text) === null;
  }

  getChunkValidationReason(text: unknown): string | null {
    if (text === null || text === undefined) {
      return 'Chunk is null or undefined';
    }

    if (typeof text !== 'string') {
      return `Chunk is not a string (${typeof text})`;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return 'Chunk is empty or whitespace only';
    }

    const wordCount = trimmed.split(/\s+/).length;
    if (wordCount < 5) {
      return `Chunk has too few words (${wordCount})`;
    }

    return null;
  }

  /**
   * Generates embeddings for a list of texts using OpenAI text-embedding-3-small.
   * Batches requests to handle large numbers of texts.
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return this.performanceTracker.track('generateEmbeddings', async () => {
      const batchSize = 100; // OpenAI allows up to 2048 inputs per request, but batch for safety
      const embeddings: number[][] = [];

      const normalizedTexts = texts.filter((text, index) => {
        const reason = this.getChunkValidationReason(text);
        if (reason !== null) {
          console.warn(
            `[EmbeddingService] Skipping invalid batch input at index ${index}: ${reason}`,
          );
          return false;
        }
        return true;
      });

      for (let i = 0; i < normalizedTexts.length; i += batchSize) {
        const batch = normalizedTexts.slice(i, i + batchSize);
        if (batch.length === 0) {
          continue;
        }

        try {
          const response = await this.openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: batch,
          });
          embeddings.push(...response.data.map((d) => d.embedding));
        } catch (error) {
          console.error('Error generating embeddings:', error);
          throw error;
        }
      }

      return embeddings;
    });
  }

  /**
   * Generates embedding for a single query text with caching.
   */
  async generateQueryEmbedding(query: string): Promise<number[]> {
    return this.performanceTracker.track(
      'generateQueryEmbedding',
      async () => {
        // Check cache first
        const cached = this.cacheService.get(query);
        if (cached) {
          this.logger.debug(
            `Embedding cache hit for query (length: ${query.length})`,
          );
          return cached;
        }

        // Generate new embedding
        const response = await this.openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: query,
        });

        const embedding = response.data[0].embedding;

        // Cache the result
        this.cacheService.set(query, embedding);

        return embedding;
      },
    );
  }
}
