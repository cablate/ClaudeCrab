import type { RateLimitConfig } from './types.js';
import { retryAsync, isTransientError } from '../utils/retry.js';
import type { ConnectionHealthMonitor } from './ConnectionHealthMonitor.js';

/** Latency statistics shape */
export interface LatencyStats {
  count: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
}

const EMPTY_LATENCY_STATS: LatencyStats = { count: 0, avgMs: 0, minMs: 0, maxMs: 0, p50Ms: 0, p95Ms: 0 };

/** Compute percentile-based latency stats from a sample array */
export function computeLatencyStats(samples: readonly number[]): LatencyStats {
  if (samples.length === 0) return { ...EMPTY_LATENCY_STATS };
  const sorted = [...samples].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count,
    avgMs: Math.round(sum / count),
    minMs: sorted[0] ?? 0,
    maxMs: sorted[count - 1] ?? 0,
    p50Ms: sorted[Math.floor(count * 0.5)] ?? 0,
    p95Ms: sorted[Math.floor(count * 0.95)] ?? 0,
  };
}

/**
 * Rate limiter for Telegram API requests
 */
export class RateLimiter {
  private readonly config: RateLimitConfig;
  private lastRequestTime: number = 0;
  private readonly queue: Array<{
    fn: () => Promise<void>;
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  private processing: boolean = false;

  // Latency tracking
  private readonly latencyHistory: number[] = [];
  private static readonly MAX_HISTORY_SIZE = 100;

  private healthMonitor: ConnectionHealthMonitor | undefined;
  private retryCount = 0;
  private failureCount = 0;

  constructor(config: RateLimitConfig, healthMonitor?: ConnectionHealthMonitor) {
    this.config = config;
    this.healthMonitor = healthMonitor;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error('Rate limit queue full');
    }

    return new Promise((resolve, reject) => {
      this.queue.push({
        fn: async () => {
          const startTime = Date.now();
          let localRetries = 0;
          try {
            const result = await retryAsync(fn, {
              maxAttempts: 4,
              initialDelayMs: 1000,
              backoffMultiplier: 2,
              isRetryable: isTransientError,
              onRetry: () => { localRetries++; },  // unused params omitted
            });
            const latency = Date.now() - startTime;
            this.recordLatency(latency);
            this.retryCount += localRetries;
            this.healthMonitor?.recordSuccess(latency);
            resolve(result);
          } catch (error) {
            const latency = Date.now() - startTime;
            this.recordLatency(latency);
            this.retryCount += localRetries;
            this.failureCount++;
            this.healthMonitor?.recordFailure();
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
        resolve: () => {},
        reject: (err: unknown) =>
          reject(err instanceof Error ? err : new Error(String(err))),
      });

      void this.processQueue();
    });
  }

  private recordLatency(latencyMs: number): void {
    this.latencyHistory.push(latencyMs);
    if (this.latencyHistory.length > RateLimiter.MAX_HISTORY_SIZE) {
      this.latencyHistory.shift();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      const waitTime = Math.max(0, this.config.minIntervalMs - elapsed);

      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      const item = this.queue.shift();
      if (item !== undefined) {
        this.lastRequestTime = Date.now();
        try {
          await item.fn();
        } catch (error) {
          item.reject(error);
        }
      }
    }

    this.processing = false;
  }

  get queueSize(): number {
    return this.queue.length;
  }

  getLatencyStats(): LatencyStats {
    return computeLatencyStats(this.latencyHistory);
  }

  /** Retry and failure counters since process start */
  getRetryStats(): { retries: number; failures: number } {
    return { retries: this.retryCount, failures: this.failureCount };
  }

}
