import { Injectable, Logger } from '@nestjs/common';

/**
 * Utility for tracking performance metrics across the RAG pipeline
 * Logs timing for each major step to identify bottlenecks
 */
export interface TimingMetric {
  step: string;
  duration: number;
  timestamp: number;
}

@Injectable()
export class PerformanceTrackerService {
  private readonly logger = new Logger(PerformanceTrackerService.name);
  private timers: Map<string, number> = new Map();
  private metrics: TimingMetric[] = [];
  private readonly maxMetricsHistory = 1000;
  private tokenCounter = 0;

  /**
   * Start timing a step and return a unique token
   */
  start(label: string): string {
    const token = `${label}:${++this.tokenCounter}`;
    this.timers.set(token, Date.now());
    return token;
  }

  /**
   * End timing and log duration
   */
  end(token: string): number {
    const startTime = this.timers.get(token);
    if (!startTime) {
      this.logger.warn(`Timer "${token}" was never started`);
      return 0;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(token);

    const [label] = token.split(':');
    const metric: TimingMetric = {
      step: label,
      duration,
      timestamp: Date.now(),
    };

    this.metrics.push(metric);

    // Keep only recent metrics to avoid memory bloat
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics = this.metrics.slice(-this.maxMetricsHistory);
    }

    // Log if duration exceeds threshold (500ms)
    if (duration > 500) {
      this.logger.warn(`[SLOW] ${label} took ${duration}ms`);
    } else {
      this.logger.debug(`${label} completed in ${duration}ms`);
    }

    return duration;
  }

  /**
   * Mark and auto-time an async operation
   */
  async track<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const token = this.start(label);
    try {
      const result = await fn();
      this.end(token);
      return result;
    } catch (error) {
      this.end(token);
      throw error;
    }
  }

  /**
   * Mark and auto-time a synchronous operation
   */
  trackSync<T>(label: string, fn: () => T): T {
    const token = this.start(label);
    try {
      const result = fn();
      this.end(token);
      return result;
    } catch (error) {
      this.end(token);
      throw error;
    }
  }

  /**
   * Get average timing for a step (useful for monitoring trends)
   */
  getAverageTime(label: string): number {
    const matching = this.metrics.filter((m) => m.step === label);
    if (matching.length === 0) {
      return 0;
    }

    const sum = matching.reduce((acc, m) => acc + m.duration, 0);
    return Math.round(sum / matching.length);
  }

  /**
   * Get performance summary for current session
   */
  getSummary(): { [key: string]: { avg: number; count: number; max: number } } {
    const summary: { [key: string]: { count: number; total: number; max: number } } = {};

    for (const metric of this.metrics) {
      if (!summary[metric.step]) {
        summary[metric.step] = { count: 0, total: 0, max: 0 };
      }
      summary[metric.step].count++;
      summary[metric.step].total += metric.duration;
      summary[metric.step].max = Math.max(
        summary[metric.step].max,
        metric.duration,
      );
    }

    const result: { [key: string]: { avg: number; count: number; max: number } } = {};
    for (const [step, stats] of Object.entries(summary)) {
      result[step] = {
        avg: Math.round(stats.total / stats.count),
        count: stats.count,
        max: stats.max,
      };
    }

    return result;
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.metrics = [];
    this.timers.clear();
    this.logger.log('Performance metrics reset');
  }
}
