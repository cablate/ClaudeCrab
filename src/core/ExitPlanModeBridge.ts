import { logger } from '../utils/logger.js';

/**
 * Decision made by the user for an ExitPlanMode (plan review) request.
 */
export interface PlanReviewDecision {
  approved: boolean;
  message?: string | undefined;
}

/**
 * Metadata about a pending plan review request.
 */
export interface PlanReviewRequestInfo {
  requestId: string;
  allowedPrompts?: Array<{
    tool: string;
    prompt: string;
  }> | undefined;
  planFilePath?: string | undefined;
  timestamp: number;
}

interface PendingEntry {
  request: PlanReviewRequestInfo;
  resolve: (decision: PlanReviewDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Promise-based bridge that coordinates async plan review decisions
 * between the SDK's ExitPlanMode tool and external user interactions
 * (e.g., Discord buttons).
 *
 * Each plan review request gets a unique requestId. The bridge holds
 * a pending Promise that resolves when:
 * - The user approves/rejects (resolveReview)
 * - The timeout expires (auto-reject)
 * - The AbortSignal fires (abort-reject)
 */
export class ExitPlanModeBridge {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly defaultTimeoutMs: number;
  private counter = 0;

  constructor(timeoutMs: number = 120_000) {
    this.defaultTimeoutMs = timeoutMs;
  }

  /**
   * Create a plan review request and return a Promise that resolves
   * when the user makes a decision (or times out / aborts).
   */
  requestReview(
    allowedPrompts: Array<{ tool: string; prompt: string }> | undefined,
    options: {
      signal: AbortSignal;
      planFilePath?: string;
    }
  ): { requestId: string; promise: Promise<PlanReviewDecision> } {
    const requestId = `plan_${Date.now()}_${++this.counter}`;

    const request: PlanReviewRequestInfo = {
      requestId,
      allowedPrompts,
      planFilePath: options.planFilePath,
      timestamp: Date.now(),
    };

    const promise = new Promise<PlanReviewDecision>((resolve) => {
      // Timeout: auto-reject
      const timer = setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          logger.warn({ requestId }, 'Plan review request timed out, rejecting');
          resolve({ approved: false, message: 'Plan review request timed out' });
        }
      }, this.defaultTimeoutMs);

      // AbortSignal: reject on abort
      const onAbort = (): void => {
        if (this.pending.has(requestId)) {
          clearTimeout(timer);
          this.pending.delete(requestId);
          resolve({ approved: false, message: 'Request aborted' });
        }
      };

      if (options.signal.aborted) {
        // Already aborted
        resolve({ approved: false, message: 'Request aborted' });
        return;
      }

      options.signal.addEventListener('abort', onAbort, { once: true });

      this.pending.set(requestId, { request, resolve, timer });
    });

    return { requestId, promise };
  }

  /**
   * Resolve a pending plan review request with the user's decision.
   * Returns false if the requestId was not found (expired / already resolved).
   */
  resolveReview(requestId: string, decision: PlanReviewDecision): boolean {
    const entry = this.pending.get(requestId);
    if (entry === undefined) {
      return false;
    }

    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve(decision);
    return true;
  }

  /**
   * Check if there's a pending request for the given requestId.
   */
  hasPending(requestId: string): boolean {
    return this.pending.has(requestId);
  }

  /**
   * Cancel all pending requests (e.g., on query abort or retry).
   * All pending promises resolve with rejected.
   */
  cancelAll(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ approved: false, message: 'All requests cancelled' });
    }
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
