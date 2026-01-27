import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramAdapter } from '../../src/adapters/TelegramAdapter.js';
import type { TelegramAdapterConfig } from '../../src/adapters/types.js';

// Create mock functions
const mockSendMessage = vi.fn().mockResolvedValue({
  message_id: 1,
  chat: { id: 12345 },
  text: 'test',
});

const mockSendChatAction = vi.fn().mockResolvedValue(true);

const mockGetMe = vi.fn().mockResolvedValue({
  id: 123456789,
  is_bot: true,
  first_name: 'TestBot',
  username: 'test_bot',
});

// Mock grammy module with proper class
vi.mock('grammy', () => {
  // Create a mock Bot class
  class MockBot {
    api = {
      getMe: mockGetMe,
      sendMessage: mockSendMessage,
      sendChatAction: mockSendChatAction,
    };
    command = vi.fn();
    on = vi.fn();
    catch = vi.fn();
    start = vi.fn().mockImplementation(({ onStart }: { onStart?: (info: { username: string }) => void }) => {
      if (onStart) {
        onStart({ username: 'test_bot' });
      }
    });
    stop = vi.fn().mockResolvedValue(undefined);

    constructor(_token: string) {
      // Token is accepted but not used in mock
    }
  }

  return {
    Bot: MockBot,
    Context: class {},
    GrammyError: class GrammyError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'GrammyError';
      }
    },
    HttpError: class HttpError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'HttpError';
      }
    },
  };
});

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter;
  let config: TelegramAdapterConfig;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    config = {
      platform: 'telegram',
      token: 'test-token',
      debug: false,
    };
    adapter = new TelegramAdapter(config);
  });

  afterEach(async () => {
    if (adapter.state !== 'uninitialized') {
      try {
        await adapter.stop();
        await adapter.dispose();
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Lifecycle', () => {
    it('should initialize successfully', async () => {
      expect(adapter.state).toBe('uninitialized');

      await adapter.initialize();

      expect(adapter.state).toBe('ready');
      // isReady() returns true only when running
      expect(adapter.isReady()).toBe(false);
    });

    it('should start and stop successfully', async () => {
      await adapter.initialize();
      await adapter.start();

      expect(adapter.state).toBe('running');
      // isReady() returns true when running
      expect(adapter.isReady()).toBe(true);

      await adapter.stop();

      expect(adapter.state).toBe('stopped');
    });

    it('should dispose successfully', async () => {
      await adapter.initialize();
      await adapter.start();
      await adapter.stop();
      await adapter.dispose();

      expect(adapter.getBot()).toBeNull();
    });

    it('should have correct platform', () => {
      expect(adapter.platform).toBe('telegram');
    });
  });

  describe('sendMessage', () => {
    it('should send a simple message', async () => {
      await adapter.initialize();

      const result = await adapter.sendMessage('12345', 'Hello, World!');

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
    });

    it('should send message with markdown', async () => {
      await adapter.initialize();

      const result = await adapter.sendMessage('12345', '**Bold** text', {
        parseMode: 'Markdown',
      });

      expect(result.success).toBe(true);
    });

    it('should return error when bot not initialized', async () => {
      const result = await adapter.sendMessage('12345', 'Test');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Bot not initialized');
    });
  });

  describe('Message Splitting', () => {
    it('should not split short messages', async () => {
      await adapter.initialize();

      await adapter.sendMessage('12345', 'Short message');

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    it('should split long messages', async () => {
      await adapter.initialize();

      // Create a message longer than MAX_MESSAGE_LENGTH (4096)
      const longMessage = 'A'.repeat(5000);
      await adapter.sendMessage('12345', longMessage);

      expect(mockSendMessage.mock.calls.length).toBeGreaterThan(1);
    });

    it('should split at newlines when possible', async () => {
      await adapter.initialize();

      // Create a message with newlines
      const part1 = 'A'.repeat(4000);
      const part2 = 'B'.repeat(100);
      const longMessage = `${part1}\n${part2}`;

      await adapter.sendMessage('12345', longMessage);

      // Should split at the newline
      expect(mockSendMessage.mock.calls.length).toBe(2);
    });
  });

  describe('sendTypingIndicator', () => {
    it('should send typing indicator', async () => {
      await adapter.initialize();

      await adapter.sendTypingIndicator('12345');

      expect(mockSendChatAction).toHaveBeenCalledWith('12345', 'typing');
    });

    it('should not throw when bot not initialized', async () => {
      await expect(
        adapter.sendTypingIndicator('12345')
      ).resolves.toBeUndefined();
    });
  });

  describe('Message Handler', () => {
    it('should register message handlers', async () => {
      const handler = vi.fn();
      adapter.onMessage(handler);

      expect(adapter['messageHandlers'].size).toBe(1);
    });

    it('should unregister message handlers', async () => {
      const handler = vi.fn();
      // onMessage returns an unsubscribe function
      const unsubscribe = adapter.onMessage(handler);
      unsubscribe();

      expect(adapter['messageHandlers'].size).toBe(0);
    });
  });

  describe('Rate Limiting', () => {
    it('should initialize with default rate limit config', () => {
      const adapter = new TelegramAdapter(config);
      expect(adapter['rateLimiter']).toBeDefined();
    });

    it('should use custom rate limit config', () => {
      const customConfig: TelegramAdapterConfig = {
        ...config,
        rateLimit: {
          maxRequestsPerSecond: 10,
          minIntervalMs: 100,
          maxQueueSize: 50,
        },
      };
      const adapter = new TelegramAdapter(customConfig);
      expect(adapter['rateLimiter']).toBeDefined();
    });
  });

  describe('Constants', () => {
    it('should have correct MAX_MESSAGE_LENGTH', () => {
      expect(TelegramAdapter.MAX_MESSAGE_LENGTH).toBe(4096);
    });
  });

  describe('Error Handling', () => {
    it('should handle GrammyError during message send', async () => {
      await adapter.initialize();

      // Import the mocked GrammyError
      const { GrammyError } = await import('grammy');

      mockSendMessage.mockRejectedValueOnce(
        new GrammyError('API Error')
      );

      const result = await adapter.sendMessage('12345', 'Test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Telegram API error');
    });

    it('should handle HttpError during message send', async () => {
      await adapter.initialize();

      const { HttpError } = await import('grammy');

      mockSendMessage.mockRejectedValueOnce(
        new HttpError('Network Error')
      );

      const result = await adapter.sendMessage('12345', 'Test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });
  });
});
