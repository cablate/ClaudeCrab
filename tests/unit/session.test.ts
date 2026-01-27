import { describe, it, expect } from 'vitest';
import {
  getSessionKey,
  parseSessionKey,
  DEFAULT_SESSION_CONFIG,
} from '../../src/types/session.js';

describe('getSessionKey', () => {
  it('should create key with double colon separator', () => {
    const key = getSessionKey('telegram', 'general', '123456');
    expect(key).toBe('telegram::general::123456');
  });

  it('should handle special characters in userId', () => {
    const key = getSessionKey('discord', 'agent1', 'user:with:colons');
    expect(key).toBe('discord::agent1::user:with:colons');
  });

  it('should handle empty strings', () => {
    const key = getSessionKey('', '', '');
    expect(key).toBe('::::');
  });
});

describe('parseSessionKey', () => {
  it('should parse valid key', () => {
    const result = parseSessionKey('telegram::general::123456');
    expect(result).toEqual({
      platform: 'telegram',
      agentId: 'general',
      userId: '123456',
    });
  });

  it('should return null for invalid key without separator', () => {
    const result = parseSessionKey('invalid-key');
    expect(result).toBeNull();
  });

  it('should return null for key with only two parts', () => {
    const result = parseSessionKey('telegram::123456');
    expect(result).toBeNull();
  });

  it('should return null for key with single colon', () => {
    const result = parseSessionKey('platform:user');
    expect(result).toBeNull();
  });
});

describe('DEFAULT_SESSION_CONFIG', () => {
  it('should have reasonable defaults', () => {
    expect(DEFAULT_SESSION_CONFIG.sessionTimeoutMs).toBe(60 * 60 * 1000); // 1 hour
    expect(DEFAULT_SESSION_CONFIG.cleanupIntervalMs).toBe(60 * 1000); // 1 minute
    expect(DEFAULT_SESSION_CONFIG.maxSessions).toBe(1000);
    expect(DEFAULT_SESSION_CONFIG.maxProcessedMessageIds).toBe(100);
  });

  it('should have all required properties', () => {
    expect(DEFAULT_SESSION_CONFIG).toHaveProperty('sessionTimeoutMs');
    expect(DEFAULT_SESSION_CONFIG).toHaveProperty('cleanupIntervalMs');
    expect(DEFAULT_SESSION_CONFIG).toHaveProperty('maxSessions');
    expect(DEFAULT_SESSION_CONFIG).toHaveProperty('maxProcessedMessageIds');
  });
});
