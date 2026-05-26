import { logger } from '../utils/logger.js';

/**
 * Answer provided by the user (or by timeout/abort) for a question.
 */
export interface QuestionAnswer {
  /** The selected option index (as string), or null if cancelled/timed out */
  answer: string | null;
}

/**
 * Metadata about a pending question request.
 */
export interface QuestionRequestInfo {
  requestId: string;
  question: string;
  header: string;
  optionLabels: string[];
  timestamp: number;
}

interface PendingEntry {
  request: QuestionRequestInfo;
  resolve: (answer: QuestionAnswer) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Promise-based bridge that coordinates async question answers
 * between the SDK's AskUserQuestion tool and external user interactions
 * (e.g., Discord buttons).
 *
 * Each question request gets a unique requestId. The bridge holds
 * a pending Promise that resolves when:
 * - The user selects an option (resolveQuestion)
 * - The timeout expires (auto-cancel)
 * - The AbortSignal fires (abort-cancel)
 */
export class QuestionBridge {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly defaultTimeoutMs: number;
  private counter = 0;

  constructor(timeoutMs: number = 120_000) {
    this.defaultTimeoutMs = timeoutMs;
  }

  /**
   * Create a question request and return a Promise that resolves
   * when the user makes a selection (or times out / aborts).
   */
  requestQuestion(
    question: string,
    header: string,
    optionLabels: string[],
    options: {
      signal: AbortSignal;
    }
  ): { requestId: string; promise: Promise<QuestionAnswer> } {
    const requestId = `q_${Date.now()}_${++this.counter}`;

    const request: QuestionRequestInfo = {
      requestId,
      question,
      header,
      optionLabels,
      timestamp: Date.now(),
    };

    const promise = new Promise<QuestionAnswer>((resolve) => {
      // Timeout: auto-cancel
      const timer = setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          logger.warn({ requestId }, 'Question request timed out');
          resolve({ answer: null });
        }
      }, this.defaultTimeoutMs);

      // AbortSignal: cancel on abort
      const onAbort = (): void => {
        if (this.pending.has(requestId)) {
          clearTimeout(timer);
          this.pending.delete(requestId);
          resolve({ answer: null });
        }
      };

      if (options.signal.aborted) {
        // Already aborted
        resolve({ answer: null });
        return;
      }

      options.signal.addEventListener('abort', onAbort, { once: true });

      this.pending.set(requestId, { request, resolve, timer });
    });

    return { requestId, promise };
  }

  /**
   * Resolve a pending question with the user's selection.
   * Returns false if the requestId was not found (expired / already resolved).
   */
  resolveQuestion(requestId: string, answer: QuestionAnswer): boolean {
    const entry = this.pending.get(requestId);
    if (entry === undefined) {
      return false;
    }

    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve(answer);
    return true;
  }

  /**
   * Get the option labels for a pending request (for index-to-label resolution).
   */
  getOptionLabels(requestId: string): string[] | undefined {
    return this.pending.get(requestId)?.request.optionLabels;
  }

  /**
   * Check if there's a pending request for the given requestId.
   */
  hasPending(requestId: string): boolean {
    return this.pending.has(requestId);
  }

  /**
   * Cancel all pending requests.
   */
  cancelAll(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ answer: null });
    }
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
