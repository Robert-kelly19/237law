import { Injectable, Logger } from '@nestjs/common';

/**
 * In-memory cache for LLM responses with TTL
 * Useful for caching frequent responses (e.g., common legal questions)
 */
export interface LLMSynthesisCacheValue {
  answer: string;
  citations: string[];
  citedArticles: LLMCitedArticle[];
  toolsUsed: string[];
  relatedArticles: unknown[];
}

export interface LLMCitedArticle {
  id: string;
  lawName: string;
  articleNumber: string;
}

interface LLMCacheEntry {
  response: LLMSynthesisCacheValue;
  timestamp: number;
  hits: number;
}

@Injectable()
export class LLMResponseCacheService {
  private readonly logger = new Logger(LLMResponseCacheService.name);
  private cache: Map<string, LLMCacheEntry> = new Map();
  private readonly maxSize = 100; // LRU limit for LLM responses
  private readonly ttl = 12 * 60 * 60 * 1000; // 12 hours
  private cleanupIntervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupInterval();
  }

  onModuleDestroy(): void {
    this.stopCleanupInterval();
  }

  /**
   * Get cached LLM response if exists and not expired
   */
  get(key: string): LLMSynthesisCacheValue | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const isExpired = Date.now() - entry.timestamp > this.ttl;
    if (isExpired) {
      this.cache.delete(key);
      return null;
    }

    entry.hits++;
    entry.timestamp = Date.now();

    return this.cloneResponse(entry.response);
  }

  /**
   * Store LLM response in cache
   */
  set(key: string, response: LLMSynthesisCacheValue): void {
    // Evict LRU entry if cache is full
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const lruKey = Array.from(this.cache.entries()).reduce(
        (min, [k, entry]) => (entry.hits < min[1].hits ? [k, entry] : min),
      )[0];
      this.cache.delete(lruKey);
    }

    this.cache.set(key, {
      response: this.cloneResponse(response),
      timestamp: Date.now(),
      hits: 0,
    });
  }

  /**
   * Generate cache key from query context
   */
  generateKey(query: string, toolsUsed: string[]): string {
    // Use a copy to avoid mutating the caller's array
    const sortedTools = [...toolsUsed].sort().join(',');
    const key = `${query}|${sortedTools}`;
    return Buffer.from(key).toString('base64');
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    this.logger.log('LLM response cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }

  /**
   * Periodically clean expired entries
   */
  private startCleanupInterval(): void {
    this.cleanupIntervalId = setInterval(
      () => {
        let cleaned = 0;
        const now = Date.now();

        for (const [key, entry] of this.cache.entries()) {
          if (now - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            cleaned++;
          }
        }

        if (cleaned > 0) {
          this.logger.debug(
            `LLM response cache cleanup: removed ${cleaned} expired entries (${this.cache.size} remaining)`,
          );
        }
      },
      60 * 60 * 1000,
    ); // Run every hour
  }

  /**
   * Stop and clear the cleanup interval
   */
  private stopCleanupInterval(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  private cloneResponse(
    response: LLMSynthesisCacheValue,
  ): LLMSynthesisCacheValue {
    return structuredClone(response);
  }
}
