import { logger, INSTANCE_ID, INSTANCE_STARTED_AT } from '../utils/logger.js';
import { EventType } from '../utils/events.js';

/**
 * Optional provider that returns a cache snapshot to enrich each heartbeat.
 * Injected from AppBootstrap once SessionManager/SDKSessionManager are up.
 * Kept as a plain function (not an interface) so we avoid cyclic imports and
 * HeartbeatService stays testable without spinning up the whole app graph.
 */
export type CacheStatsProvider = () => Record<string, unknown>;

/**
 * HeartbeatService — emits `lifecycle.heartbeat` events on a fixed interval.
 *
 * Purpose: AI/human diagnostics for the "am I running alone?" question.
 * - Every tick carries `instance_id` (from logger base), so grepping heartbeat
 *   lines and counting unique instance_ids exposes duplicate instances.
 * - Carries memory + uptime so sudden leaks or restarts are visible as
 *   step-changes on a grep+jq timeline.
 * - Optionally carries a `cache` block (via setCacheStatsProvider) so cache
 *   efficiency trends are visible alongside process health.
 *
 * Disabled when interval <= 0 (set HEARTBEAT_INTERVAL_MS=0 to silence).
 */
export class HeartbeatService {
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private cacheStatsProvider: CacheStatsProvider | null = null;

  constructor(intervalMs?: number) {
    const envVal = process.env['HEARTBEAT_INTERVAL_MS'];
    const parsed = envVal !== undefined ? Number.parseInt(envVal, 10) : Number.NaN;
    this.intervalMs = intervalMs ?? (Number.isFinite(parsed) ? parsed : 60_000);
  }

  /**
   * Register (or replace) the cache stats provider. Safe to call at any time;
   * a null provider reverts to pure process-level heartbeats.
   */
  setCacheStatsProvider(provider: CacheStatsProvider | null): void {
    this.cacheStatsProvider = provider;
  }

  start(): void {
    if (this.intervalMs <= 0) {
      logger.debug({ event_type: EventType.LIFECYCLE_HEARTBEAT_DISABLED }, 'Heartbeat disabled');
      return;
    }
    if (this.timer !== null) return;
    // Emit one immediately so the first heartbeat lands right after startup,
    // not a full interval later — useful for spotting duplicate instances fast.
    this.emit();
    this.timer = setInterval(() => this.emit(), this.intervalMs);
    // Don't keep the event loop alive just for heartbeats.
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private emit(): void {
    const mem = process.memoryUsage();
    const payload: Record<string, unknown> = {
      event_type: EventType.LIFECYCLE_HEARTBEAT,
      uptime_s: Math.floor((Date.now() - INSTANCE_STARTED_AT) / 1000),
      memory_rss_mb: Math.round(mem.rss / 1024 / 1024),
      memory_heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      memory_heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
    };

    // Enrich with cache snapshot when available. Provider is `try`-guarded so
    // a bug in stats gathering never kills heartbeats (which would in turn
    // kill our duplicate-instance detection).
    if (this.cacheStatsProvider !== null) {
      try {
        payload['cache'] = this.cacheStatsProvider();
      } catch (err) {
        payload['cache_error'] = err instanceof Error ? err.message : String(err);
      }
    }

    logger.info(payload, `Heartbeat ${INSTANCE_ID}`);
  }
}
