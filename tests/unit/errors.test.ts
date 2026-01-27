import { describe, it, expect } from 'vitest';
import {
  ClaudeCabError,
  AgentLoadError,
  AgentConfigError,
  AgentNotFoundError,
  SessionError,
  RateLimitError,
  AdapterError,
  isClaudeCabError,
  wrapError,
} from '../../src/types/errors.js';

describe('ClaudeCabError', () => {
  it('should create error with all properties', () => {
    const cause = new Error('Original error');
    const error = new ClaudeCabError(
      'Test message',
      'TEST_CODE',
      true,
      '使用者訊息',
      cause
    );

    expect(error.message).toBe('Test message');
    expect(error.code).toBe('TEST_CODE');
    expect(error.recoverable).toBe(true);
    expect(error.userMessage).toBe('使用者訊息');
    expect(error.cause).toBe(cause);
    expect(error.name).toBe('ClaudeCabError');
  });

  it('should be instanceof Error', () => {
    const error = new ClaudeCabError('Test', 'CODE', true);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ClaudeCabError);
  });

  it('should convert to JSON correctly', () => {
    const error = new ClaudeCabError('Test', 'CODE', true, 'User msg');
    const json = error.toJSON();

    expect(json.name).toBe('ClaudeCabError');
    expect(json.message).toBe('Test');
    expect(json.code).toBe('CODE');
    expect(json.recoverable).toBe(true);
    expect(json.userMessage).toBe('User msg');
  });
});

describe('AgentLoadError', () => {
  it('should include agent ID in message', () => {
    const cause = new Error('File not found');
    const error = new AgentLoadError('my-agent', cause);

    expect(error.message).toContain('my-agent');
    expect(error.message).toContain('File not found');
    expect(error.agentId).toBe('my-agent');
    expect(error.code).toBe('AGENT_LOAD_FAILED');
    expect(error.recoverable).toBe(true);
  });
});

describe('AgentConfigError', () => {
  it('should include validation errors', () => {
    const error = new AgentConfigError('test-agent', [
      'name is required',
      'model is invalid',
    ]);

    expect(error.message).toContain('test-agent');
    expect(error.message).toContain('name is required');
    expect(error.validationErrors).toHaveLength(2);
    expect(error.code).toBe('AGENT_CONFIG_INVALID');
  });
});

describe('AgentNotFoundError', () => {
  it('should include agent ID', () => {
    const error = new AgentNotFoundError('missing-agent');

    expect(error.message).toContain('missing-agent');
    expect(error.agentId).toBe('missing-agent');
    expect(error.code).toBe('AGENT_NOT_FOUND');
  });
});

describe('SessionError', () => {
  it('should set recoverable based on error code', () => {
    const notFoundError = new SessionError('NOT_FOUND', 'Session not found');
    expect(notFoundError.recoverable).toBe(true);

    const sdkError = new SessionError('SDK_ERROR', 'SDK failed');
    expect(sdkError.recoverable).toBe(false);

    const timeoutError = new SessionError('TIMEOUT', 'Timed out');
    expect(timeoutError.recoverable).toBe(true);
  });
});

describe('RateLimitError', () => {
  it('should include retry after time', () => {
    const error = new RateLimitError(5000);

    expect(error.retryAfter).toBe(5000);
    expect(error.message).toContain('5000');
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.recoverable).toBe(true);
  });
});

describe('AdapterError', () => {
  it('should include platform in message', () => {
    const error = new AdapterError('telegram', 'Connection failed');

    expect(error.message).toContain('[telegram]');
    expect(error.platform).toBe('telegram');
    expect(error.code).toBe('ADAPTER_ERROR');
  });
});

describe('isClaudeCabError', () => {
  it('should return true for ClaudeCabError instances', () => {
    const error = new ClaudeCabError('Test', 'CODE', true);
    expect(isClaudeCabError(error)).toBe(true);
  });

  it('should return true for derived error classes', () => {
    const error = new AgentLoadError('test', new Error('cause'));
    expect(isClaudeCabError(error)).toBe(true);
  });

  it('should return false for regular Error', () => {
    const error = new Error('Regular error');
    expect(isClaudeCabError(error)).toBe(false);
  });

  it('should return false for non-error values', () => {
    expect(isClaudeCabError('string')).toBe(false);
    expect(isClaudeCabError(null)).toBe(false);
    expect(isClaudeCabError(undefined)).toBe(false);
    expect(isClaudeCabError({})).toBe(false);
  });
});

describe('wrapError', () => {
  it('should return ClaudeCabError as-is', () => {
    const original = new ClaudeCabError('Test', 'CODE', true);
    const wrapped = wrapError(original);
    expect(wrapped).toBe(original);
  });

  it('should wrap regular Error', () => {
    const original = new Error('Original message');
    const wrapped = wrapError(original);

    expect(wrapped).toBeInstanceOf(ClaudeCabError);
    expect(wrapped.message).toBe('Original message');
    expect(wrapped.cause).toBe(original);
    expect(wrapped.code).toBe('UNKNOWN_ERROR');
  });

  it('should wrap string', () => {
    const wrapped = wrapError('String error');

    expect(wrapped).toBeInstanceOf(ClaudeCabError);
    expect(wrapped.message).toBe('String error');
  });

  it('should add context prefix', () => {
    const original = new Error('Failed');
    const wrapped = wrapError(original, 'Loading agent');

    expect(wrapped.message).toBe('Loading agent: Failed');
  });
});
