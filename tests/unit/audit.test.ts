import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest';
import type { UnifiedMessage } from '../../src/adapters/types.js';

// Store reference to mock function
let mockLogInfo: MockInstance;

// Mock logger before importing auditLogger
vi.mock('../../src/utils/logger.js', () => {
  const infoFn = vi.fn();
  mockLogInfo = infoFn;
  return {
    logger: {
      info: infoFn,
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

// Import after mocking
const { auditLogger } = await import('../../src/utils/audit.js');

describe('Audit Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('logUserMessage', () => {
    it('should log user message with correct structure', () => {
      const message: UnifiedMessage = {
        id: 'test-123',
        platform: 'telegram',
        userId: '12345',
        chatId: '67890',
        text: 'Hello world',
        timestamp: new Date(),
      };

      auditLogger.logUserMessage(message, 'session-abc');

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          audit: true,
          event: expect.objectContaining({
            type: 'user:message',
            platform: 'telegram',
            userId: '12345',
            chatId: '67890',
            sessionId: 'session-abc',
            data: expect.objectContaining({
              messageId: 'test-123',
              textLength: 11,
            }),
            outcome: 'success',
          }),
        }),
        expect.any(String)
      );
    });
  });

  describe('logUserCommand', () => {
    it('should log command with arguments', () => {
      auditLogger.logUserCommand('telegram', '12345', 'switch', 'coder', 'session-abc');

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          audit: true,
          event: expect.objectContaining({
            type: 'user:command',
            platform: 'telegram',
            userId: '12345',
            sessionId: 'session-abc',
            data: expect.objectContaining({
              command: 'switch',
              args: 'coder',
            }),
          }),
        }),
        expect.any(String)
      );
    });

    it('should log command without arguments', () => {
      auditLogger.logUserCommand('telegram', '12345', 'help', undefined, 'session-abc');

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          audit: true,
          event: expect.objectContaining({
            type: 'user:command',
            data: expect.objectContaining({
              command: 'help',
              args: undefined,
            }),
          }),
        }),
        expect.any(String)
      );
    });
  });

  describe('logUnauthorizedAccess', () => {
    it('should log unauthorized access with failure outcome', () => {
      auditLogger.logUnauthorizedAccess('telegram', '99999', '12345');

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          audit: true,
          event: expect.objectContaining({
            type: 'user:unauthorized',
            platform: 'telegram',
            userId: '99999',
            chatId: '12345',
            outcome: 'failure',
          }),
        }),
        expect.any(String)
      );
    });
  });

  describe('logBotResponse', () => {
    it('should log bot response with response length', () => {
      auditLogger.logBotResponse('telegram', '12345', '67890', 500, 'session-abc');

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          audit: true,
          event: expect.objectContaining({
            type: 'bot:response',
            platform: 'telegram',
            userId: '12345',
            chatId: '67890',
            sessionId: 'session-abc',
            data: expect.objectContaining({
              responseLength: 500,
            }),
            outcome: 'success',
          }),
        }),
        expect.any(String)
      );
    });
  });

  describe('logBotError', () => {
    it('should log bot error with failure outcome', () => {
      auditLogger.logBotError('telegram', '12345', 'API timeout', 'session-abc');

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          audit: true,
          event: expect.objectContaining({
            type: 'bot:error',
            platform: 'telegram',
            userId: '12345',
            sessionId: 'session-abc',
            error: 'API timeout',
            outcome: 'failure',
          }),
        }),
        expect.any(String)
      );
    });
  });

  describe('logSessionCreated', () => {
    it('should log session creation with agent ID', () => {
      auditLogger.logSessionCreated('telegram', '12345', 'session-abc', 'default');

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          audit: true,
          event: expect.objectContaining({
            type: 'session:created',
            platform: 'telegram',
            userId: '12345',
            sessionId: 'session-abc',
            data: expect.objectContaining({
              agentId: 'default',
            }),
            outcome: 'success',
          }),
        }),
        expect.any(String)
      );
    });
  });

  describe('logAgentSwitch', () => {
    it('should log agent switch with from and to agents', () => {
      auditLogger.logAgentSwitch('telegram', '12345', 'session-abc', 'default', 'coder');

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          audit: true,
          event: expect.objectContaining({
            type: 'session:switched',
            platform: 'telegram',
            userId: '12345',
            sessionId: 'session-abc',
            data: expect.objectContaining({
              fromAgentId: 'default',
              toAgentId: 'coder',
            }),
            outcome: 'success',
          }),
        }),
        expect.any(String)
      );
    });
  });

  describe('logSessionReset', () => {
    it('should log session reset', () => {
      auditLogger.logSessionReset('telegram', '12345', 'session-abc');

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          audit: true,
          event: expect.objectContaining({
            type: 'session:reset',
            platform: 'telegram',
            userId: '12345',
            sessionId: 'session-abc',
            outcome: 'success',
          }),
        }),
        expect.any(String)
      );
    });
  });

  describe('logValidationFailed', () => {
    it('should log validation failure with reason', () => {
      auditLogger.logValidationFailed('telegram', '12345', 'message_too_long', '67890');

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          audit: true,
          event: expect.objectContaining({
            type: 'security:validation_failed',
            platform: 'telegram',
            userId: '12345',
            chatId: '67890',
            data: expect.objectContaining({
              reason: 'message_too_long',
            }),
            outcome: 'failure',
          }),
        }),
        expect.any(String)
      );
    });
  });

  describe('logInjectionDetected', () => {
    it('should log injection detection with patterns', () => {
      const patterns = ['pattern1', 'pattern2', 'pattern3', 'pattern4', 'pattern5'];

      auditLogger.logInjectionDetected('telegram', '12345', patterns, '67890');

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          audit: true,
          event: expect.objectContaining({
            type: 'security:injection_detected',
            platform: 'telegram',
            userId: '12345',
            chatId: '67890',
            data: expect.objectContaining({
              patternCount: 5,
              patterns: ['pattern1', 'pattern2', 'pattern3'], // Only first 3
            }),
            outcome: 'warning',
          }),
        }),
        expect.any(String)
      );
    });
  });

  describe('logToolCalled', () => {
    it('should log tool call', () => {
      auditLogger.logToolCalled('telegram', '12345', 'session-abc', 'web_search', { query: 'test' });

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          audit: true,
          event: expect.objectContaining({
            type: 'tool:called',
            platform: 'telegram',
            userId: '12345',
            sessionId: 'session-abc',
            data: expect.objectContaining({
              toolName: 'web_search',
              hasInput: true,
            }),
            outcome: 'success',
          }),
        }),
        expect.any(String)
      );
    });
  });

  describe('logToolCompleted', () => {
    it('should log tool completion with duration', () => {
      auditLogger.logToolCompleted('telegram', '12345', 'session-abc', 'web_search', 150);

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          audit: true,
          event: expect.objectContaining({
            type: 'tool:completed',
            platform: 'telegram',
            userId: '12345',
            sessionId: 'session-abc',
            data: expect.objectContaining({
              toolName: 'web_search',
              durationMs: 150,
            }),
            outcome: 'success',
          }),
        }),
        expect.any(String)
      );
    });
  });

  describe('logToolFailed', () => {
    it('should log tool failure with error', () => {
      auditLogger.logToolFailed('telegram', '12345', 'session-abc', 'web_search', 'Network timeout');

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          audit: true,
          event: expect.objectContaining({
            type: 'tool:failed',
            platform: 'telegram',
            userId: '12345',
            sessionId: 'session-abc',
            data: expect.objectContaining({
              toolName: 'web_search',
            }),
            error: 'Network timeout',
            outcome: 'failure',
          }),
        }),
        expect.any(String)
      );
    });
  });

  describe('event timestamps', () => {
    it('should include ISO timestamp in events', () => {
      const before = new Date().toISOString();

      auditLogger.logUserCommand('telegram', '12345', 'help');

      const after = new Date().toISOString();

      expect(mockLogInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({
            timestamp: expect.any(String),
          }),
        }),
        expect.any(String)
      );

      const call = (mockLogInfo as MockInstance).mock.calls[0][0] as { event: { timestamp: string } };
      const timestamp = call.event.timestamp;
      expect(timestamp >= before).toBe(true);
      expect(timestamp <= after).toBe(true);
    });
  });
});
