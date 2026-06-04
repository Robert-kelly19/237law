import { Injectable, Logger } from '@nestjs/common';

/**
 * In-memory LRU cache for embedding queries
 * Stores recent query embeddings to avoid repeated OpenAI calls
 */
interface CacheEntry {
  embedding: number[];
  timestamp: number;
  hits: number;
}

@Injectable()
export class EmbeddingCacheService {
  private readonly logger = new Logger(EmbeddingCacheService.name);
  private cache: Map<string, CacheEntry> = new Map();
  private readonly maxSize = 200; // LRU limit
  private readonly ttl = 24 * 60 * 60 * 1000; // 24 hours
  private cleanupIntervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupInterval();
  }

  onModuleDestroy(): void {
    this.stopCleanupInterval();
  }

  /**
   * Get embedding from cache if exists and not expired
   */
  get(query: string): number[] | null {
    const hash = this.hashQuery(query);
    const entry = this.cache.get(hash);

    if (!entry) {
      return null;
    }

    const isExpired = Date.now() - entry.timestamp > this.ttl;
    if (isExpired) {
      this.cache.delete(hash);
      return null;
    }

    // Update hit count and LRU tracking
    entry.hits++;
    entry.timestamp = Date.now();

    // Return defensive copy to prevent mutation of cached state
    return Array.from(entry.embedding);
  }

  /**
   * Store embedding in cache
   */
  set(query: string, embedding: number[]): void {
    const hash = this.hashQuery(query);

    // Evict LRU entry if cache is full
    if (
      this.cache.size >= this.maxSize &&
      !this.cache.has(hash)
    ) {
      const lruKey = Array.from(this.cache.entries()).reduce((min, [key, entry]) =>
        entry.hits < min[1].hits ? [key, entry] : min,
      )[0];
      this.cache.delete(lruKey);
    }

    // Store defensive copy to prevent external mutations
    this.cache.set(hash, {
      embedding: Array.from(embedding),
      timestamp: Date.now(),
      hits: 0,
    });
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    this.logger.log('Embedding cache cleared');
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
   * Simple hash for query normalization
   */
  private hashQuery(query: string): string {
    const normalized = query.toLowerCase().trim();
    return Buffer.from(normalized).toString('base64');
  }

  /**
   * Periodically clean expired entries
   */
  private startCleanupInterval(): void {
    this.cleanupIntervalId = setInterval(() => {
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
          `Embedding cache cleanup: removed ${cleaned} expired entries (${this.cache.size} remaining)`,
        );
      }
    }, 60 * 60 * 1000); // Run every hour
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
}
