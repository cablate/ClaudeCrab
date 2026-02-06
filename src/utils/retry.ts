import { logger } from './logger.js';

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;

  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;

  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;

  /** Exponential backoff multiplier (default: 2) */
  backoffMultiplier?: number;

  /** Jitter factor (0-1) to add randomness to delays (default: 0.1) */
  jitterFactor?: number;

  /** Function to determine if an error is retryable */
  isRetryable?: (error: unknown) => boolean;

  /** Optional callback on each retry */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

/**
 * Default retry options
 */
const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> & {
  onRetry?: RetryOptions['onRetry'];
} = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
  isRetryable: () => true,
};

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
  /** Whether the operation succeeded */
  success: boolean;

  /** The result value if successful */
  value?: T;

  /** The last error if all retries failed */
  error?: unknown;

  /** Number of attempts made */
  attempts: number;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  options: Required<Omit<RetryOptions, 'onRetry'>>
): number {
  // Calculate base exponential delay
  const exponentialDelay =
    options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);

  // Apply maximum cap
  const cappedDelay = Math.min(exponentialDelay, options.maxDelayMs);

  // Add jitter
  const jitter = cappedDelay * options.jitterFactor * (Math.random() * 2 - 1);
  const finalDelay = Math.max(0, Math.round(cappedDelay + jitter));

  return finalDelay;
}

/**
 * Execute an async function with retry and exponential backoff
 *
 * @param fn The async function to execute
 * @param options Retry configuration options
 * @returns RetryResult with success status, value or error, and attempt count
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;
  let attempt = 0;

  while (attempt < opts.maxAttempts) {
    attempt++;

    try {
      const value = await fn();
      return {
        success: true,
        value,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= opts.maxAttempts || !opts.isRetryable(error)) {
        break;
      }

      // Calculate delay for next attempt
      const delayMs = calculateDelay(attempt, opts);

      // Log and invoke callback
      logger.warn(
        {
          attempt,
          maxAttempts: opts.maxAttempts,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        },
        'Retrying after error'
      );

      if (opts.onRetry !== undefined) {
        opts.onRetry(attempt, error, delayMs);
      }

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: attempt,
  };
}

/**
 * Execute an async function with retry, throwing on failure
 *
 * @param fn The async function to execute
 * @param options Retry configuration options
 * @returns The result value
 * @throws The last error if all retries fail
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const result = await withRetry(fn, options);

  if (!result.success) {
    throw result.error;
  }

  return result.value as T;
}

/**
 * Check if an error is a rate limit error
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('429')
    );
  }
  return false;
}

/**
 * Check if an error is a transient/network error that should be retried
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('etimedout') ||
      message.includes('socket') ||
      message.includes('503') ||
      message.includes('502') ||
      message.includes('500') ||
      message.includes('529') ||
      message.includes('overloaded') ||
      message.includes('tool_use ids must be unique')
    );
  }
  return false;
}

/**
 * Check if an error should be retried (rate limit or transient error)
 */
export function shouldRetryError(error: unknown): boolean {
  return isRateLimitError(error) || isTransientError(error);
}

/**
 * Default retry options for API calls
 */
export const API_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
  isRetryable: shouldRetryError,
};

/**
 * Rate limit specific retry options (longer delays)
 */
export const RATE_LIMIT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 5,
  initialDelayMs: 5000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  jitterFactor: 0.2,
  isRetryable: isRateLimitError,
};
