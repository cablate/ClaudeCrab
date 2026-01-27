import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withRetry,
  retryAsync,
  isRateLimitError,
  isTransientError,
  shouldRetryError,
  API_RETRY_OPTIONS,
} from '../../src/utils/retry.js';

describe('Retry Utilities', () => {
  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withRetry(fn);

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce('success');

      const result = await withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 10, // Use small delays for testing
        jitterFactor: 0,
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');
      expect(result.attempts).toBe(2);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should fail after max attempts', async () => {
      const error = new Error('persistent failure');
      const fn = vi.fn().mockRejectedValue(error);

      const result = await withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 10,
        backoffMultiplier: 2,
        jitterFactor: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
      expect(result.attempts).toBe(3);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should respect isRetryable option', async () => {
      const nonRetryableError = new Error('not retryable');
      const fn = vi.fn().mockRejectedValue(nonRetryableError);

      const result = await withRetry(fn, {
        maxAttempts: 3,
        isRetryable: () => false,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should call onRetry callback', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValueOnce('success');

      const onRetry = vi.fn();

      const result = await withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 10,
        jitterFactor: 0,
        onRetry,
      });

      expect(result.success).toBe(true);
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(
        1,
        1,
        expect.any(Error),
        expect.any(Number)
      );
      expect(onRetry).toHaveBeenNthCalledWith(
        2,
        2,
        expect.any(Error),
        expect.any(Number)
      );
    });

    it('should apply exponential backoff', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      const delays: number[] = [];

      await withRetry(fn, {
        maxAttempts: 4,
        initialDelayMs: 10,
        backoffMultiplier: 2,
        jitterFactor: 0,
        onRetry: (_attempt, _error, delayMs) => {
          delays.push(delayMs);
        },
      });

      // 10, 20, 40
      expect(delays).toEqual([10, 20, 40]);
    });

    it('should respect maxDelayMs cap', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      const delays: number[] = [];

      await withRetry(fn, {
        maxAttempts: 5,
        initialDelayMs: 10,
        maxDelayMs: 30,
        backoffMultiplier: 2,
        jitterFactor: 0,
        onRetry: (_attempt, _error, delayMs) => {
          delays.push(delayMs);
        },
      });

      // 10, 20, 30 (capped), 30 (capped)
      expect(delays).toEqual([10, 20, 30, 30]);
    });
  });

  describe('retryAsync', () => {
    it('should return value on success', async () => {
      const fn = vi.fn().mockResolvedValue('result');

      const result = await retryAsync(fn);

      expect(result).toBe('result');
    });

    it('should throw on failure', async () => {
      const error = new Error('failure');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(retryAsync(fn, { maxAttempts: 1 })).rejects.toThrow('failure');
    });
  });

  describe('Error Classification', () => {
    describe('isRateLimitError', () => {
      it('should detect rate limit errors', () => {
        expect(isRateLimitError(new Error('rate limit exceeded'))).toBe(true);
        expect(isRateLimitError(new Error('too many requests'))).toBe(true);
        expect(isRateLimitError(new Error('HTTP 429'))).toBe(true);
      });

      it('should return false for non-rate-limit errors', () => {
        expect(isRateLimitError(new Error('network error'))).toBe(false);
        expect(isRateLimitError(new Error('invalid request'))).toBe(false);
        expect(isRateLimitError('string error')).toBe(false);
      });
    });

    describe('isTransientError', () => {
      it('should detect timeout errors', () => {
        expect(isTransientError(new Error('request timeout'))).toBe(true);
        expect(isTransientError(new Error('ETIMEDOUT'))).toBe(true);
      });

      it('should detect network errors', () => {
        expect(isTransientError(new Error('network error'))).toBe(true);
        expect(isTransientError(new Error('connection refused'))).toBe(true);
        expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
        expect(isTransientError(new Error('ECONNREFUSED'))).toBe(true);
        expect(isTransientError(new Error('socket error'))).toBe(true);
      });

      it('should detect server errors', () => {
        expect(isTransientError(new Error('HTTP 500'))).toBe(true);
        expect(isTransientError(new Error('HTTP 502'))).toBe(true);
        expect(isTransientError(new Error('HTTP 503'))).toBe(true);
      });

      it('should return false for client errors', () => {
        expect(isTransientError(new Error('invalid request'))).toBe(false);
        expect(isTransientError(new Error('HTTP 400'))).toBe(false);
        expect(isTransientError(new Error('HTTP 401'))).toBe(false);
      });
    });

    describe('shouldRetryError', () => {
      it('should return true for retryable errors', () => {
        expect(shouldRetryError(new Error('rate limit'))).toBe(true);
        expect(shouldRetryError(new Error('timeout'))).toBe(true);
        expect(shouldRetryError(new Error('network error'))).toBe(true);
      });

      it('should return false for non-retryable errors', () => {
        expect(shouldRetryError(new Error('invalid request'))).toBe(false);
        expect(shouldRetryError(new Error('unauthorized'))).toBe(false);
      });
    });
  });

  describe('API_RETRY_OPTIONS', () => {
    it('should have reasonable defaults', () => {
      expect(API_RETRY_OPTIONS.maxAttempts).toBe(3);
      expect(API_RETRY_OPTIONS.initialDelayMs).toBe(1000);
      expect(API_RETRY_OPTIONS.maxDelayMs).toBe(30000);
      expect(API_RETRY_OPTIONS.backoffMultiplier).toBe(2);
    });

    it('should use shouldRetryError for isRetryable', () => {
      expect(API_RETRY_OPTIONS.isRetryable?.(new Error('rate limit'))).toBe(
        true
      );
      expect(API_RETRY_OPTIONS.isRetryable?.(new Error('timeout'))).toBe(true);
      expect(API_RETRY_OPTIONS.isRetryable?.(new Error('invalid'))).toBe(false);
    });
  });
});
