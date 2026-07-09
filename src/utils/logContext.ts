import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-operation log context — threaded through async boundaries via
 * AsyncLocalStorage. Every `logger.*` call inside a `logContext.run()`
 * block automatically inherits these fields (see logger.ts mixin).
 *
 * AI diagnostic contract: `grep correlation_id=<id> logs/*.log` returns
 * every log line belonging to one user interaction, in order.
 */
export interface LogContext {
  /** UUIDv7-ish, unique per logical operation (e.g. one user message). */
  correlation_id: string;
  /** Platform message id if the context started at an ingress (may equal correlation_id for synthesized messages). */
  message_id?: string;
  platform?: string;
  agent_id?: string;
  user_id?: string;
  chat_id?: string;
  session_id?: string;
  /** For child task-notification work: which correlation_id spawned this one. */
  parent_correlation_id?: string;
  [key: string]: unknown;
}

const storage = new AsyncLocalStorage<LogContext>();

export const logContext = {
  run<R>(ctx: LogContext, fn: () => R): R {
    return storage.run(ctx, fn);
  },
  get(): LogContext | undefined {
    return storage.getStore();
  },
  /**
   * Mutate the current context in-place. Used to add fields discovered
   * mid-flow (e.g. session_id once resolved). No-op if no active context.
   */
  extend(patch: Partial<LogContext>): void {
    const current = storage.getStore();
    if (current) Object.assign(current, patch);
  },
};

/**
 * Generate a time-sortable correlation id. Not RFC4122 UUIDv7 — we don't
 * need the extra bytes. Format: `c_<epoch36>_<rand6>` (~17 chars).
 * Collisions are vanishingly unlikely within a single instance lifetime.
 */
export const newCorrelationId = (): string => {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `c_${ts}_${rand}`;
};
