/**
 * Lightweight connection health monitor.
 * Tracks recent API call latency and success rate over a sliding window
 * to derive an overall connection state: healthy / degraded / unhealthy.
 */

export type ConnectionState = 'healthy' | 'degraded' | 'unhealthy';

export interface ConnectionHealthConfig {
  /** P95 above this → degraded (ms). Default 3000 */
  degradedThresholdMs: number;
  /** P95 above this → unhealthy (ms). Default 10000 */
  unhealthyThresholdMs: number;
  /** Consecutive failures above this → unhealthy. Default 3 */
  failureThreshold: number;
  /** Sliding window size (number of samples). Default 20 */
  windowSize: number;
}

export const DEFAULT_HEALTH_CONFIG: ConnectionHealthConfig = {
  degradedThresholdMs: 3000,
  unhealthyThresholdMs: 10000,
  failureThreshold: 3,
  windowSize: 20,
};

export interface HealthInfo {
  state: ConnectionState;
  consecutiveFailures: number;
  recentP95Ms: number;
  stateDurationMs: number;
}

export class ConnectionHealthMonitor {
  private readonly config: ConnectionHealthConfig;
  private readonly samples: number[] = [];
  private consecutiveFailures = 0;
  private currentState: ConnectionState = 'healthy';
  private stateChangedAt: number = Date.now();

  /** Optional callback fired on state transitions */
  onStateChange?: (prev: ConnectionState, next: ConnectionState, info: HealthInfo) => void;

  constructor(config: Partial<ConnectionHealthConfig> = {}) {
    this.config = { ...DEFAULT_HEALTH_CONFIG, ...config };
  }

  /** Record a successful API call with its latency */
  recordSuccess(latencyMs: number): void {
    this.consecutiveFailures = 0;
    this.pushSample(latencyMs);
    this.evaluate();
  }

  /** Record a failed API call */
  recordFailure(): void {
    this.consecutiveFailures++;
    this.evaluate();
  }

  /** Current connection state */
  getState(): ConnectionState {
    return this.currentState;
  }

  /** Detailed health info snapshot */
  getHealthInfo(): HealthInfo {
    return {
      state: this.currentState,
      consecutiveFailures: this.consecutiveFailures,
      recentP95Ms: this.computeP95(),
      stateDurationMs: Date.now() - this.stateChangedAt,
    };
  }

  // ── internals ──

  private pushSample(latencyMs: number): void {
    this.samples.push(latencyMs);
    if (this.samples.length > this.config.windowSize) {
      this.samples.shift();
    }
  }

  private computeP95(): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  }

  private evaluate(): void {
    const prev = this.currentState;
    let next: ConnectionState = 'healthy';

    // Cache P95 to avoid recomputation in onStateChange → getHealthInfo()
    const p95 = this.computeP95();

    if (this.consecutiveFailures >= this.config.failureThreshold) {
      next = 'unhealthy';
    } else if (p95 >= this.config.unhealthyThresholdMs) {
      next = 'unhealthy';
    } else if (p95 >= this.config.degradedThresholdMs) {
      next = 'degraded';
    }

    if (next !== prev) {
      this.currentState = next;
      this.stateChangedAt = Date.now();
      // Pass pre-computed info to avoid redundant computeP95() call
      this.onStateChange?.(prev, next, {
        state: next,
        consecutiveFailures: this.consecutiveFailures,
        recentP95Ms: p95,
        stateDurationMs: 0, // just transitioned
      });
    }
  }
}
