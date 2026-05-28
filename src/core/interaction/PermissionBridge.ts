import { logger } from '../../utils/logger.js';

/**
 * Decision made by the user (or by timeout/abort) for a permission request.
 */
export interface PermissionDecision {
  behavior: 'allow' | 'deny';
  message?: string;
  alwaysAllow?: boolean;
}

/**
 * Metadata about a pending permission request.
 */
export interface PermissionRequestInfo {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseID: string;
  decisionReason?: string | undefined;
  blockedPath?: string | undefined;
  timestamp: number;
}

interface PendingEntry {
  request: PermissionRequestInfo;
  resolve: (decision: PermissionDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Promise-based bridge that coordinates async permission decisions
 * between the SDK's synchronous canUseTool callback and external
 * user interactions (e.g., Discord buttons).
 *
 * Each permission request gets a unique requestId. The bridge holds
 * a pending Promise that resolves when:
 * - The user makes a decision (resolvePermission)
 * - The timeout expires (auto-deny)
 * - The AbortSignal fires (abort-deny)
 * - cancelAll() is called (e.g., on query retry)
 */
export class PermissionBridge {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly defaultTimeoutMs: number;
  private counter = 0;

  constructor(timeoutMs: number = 120_000) {
    this.defaultTimeoutMs = timeoutMs;
  }

  /**
   * Create a permission request and return a Promise that resolves
   * when the user makes a decision (or times out / aborts).
   */
  requestPermission(
    toolName: string,
    toolInput: Record<string, unknown>,
    options: {
      signal: AbortSignal;
      toolUseID: string;
      decisionReason?: string;
      blockedPath?: string;
    }
  ): { requestId: string; promise: Promise<PermissionDecision> } {
    const requestId = `perm_${Date.now()}_${++this.counter}`;

    const request: PermissionRequestInfo = {
      requestId,
      toolName,
      toolInput,
      toolUseID: options.toolUseID,
      decisionReason: options.decisionReason,
      blockedPath: options.blockedPath,
      timestamp: Date.now(),
    };

    const promise = new Promise<PermissionDecision>((resolve) => {
      // Timeout: auto-deny
      const timer = setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          logger.warn({ requestId, toolName }, 'Permission request timed out, denying');
          resolve({ behavior: 'deny', message: 'Permission request timed out' });
        }
      }, this.defaultTimeoutMs);

      // AbortSignal: deny on abort
      const onAbort = (): void => {
        if (this.pending.has(requestId)) {
          clearTimeout(timer);
          this.pending.delete(requestId);
          resolve({ behavior: 'deny', message: 'Request aborted' });
        }
      };

      if (options.signal.aborted) {
        // Already aborted
        resolve({ behavior: 'deny', message: 'Request aborted' });
        return;
      }

      options.signal.addEventListener('abort', onAbort, { once: true });

      this.pending.set(requestId, { request, resolve, timer });
    });

    return { requestId, promise };
  }

  /**
   * Resolve a pending permission request with the user's decision.
   * Returns false if the requestId was not found (expired / already resolved).
   */
  resolvePermission(requestId: string, decision: PermissionDecision): boolean {
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
   * All pending promises resolve with deny.
   */
  cancelAll(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ behavior: 'deny', message: 'All requests cancelled' });
    }
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
