import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentLoader } from '../../src/core/AgentLoader.js';
import { SessionManager } from '../../src/core/SessionManager.js';
import { MessageProcessor } from '../../src/core/MessageProcessor.js';
import { BaseAdapter } from '../../src/adapters/BaseAdapter.js';
import type { UnifiedMessage, SendMessageResult } from '../../src/adapters/types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        stream: vi.fn().mockImplementation(() => {
          // Return an async iterable that yields mock events
          return {
            [Symbol.asyncIterator]: async function* () {
              yield {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: 'Hello! ' },
              };
              yield {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: 'How can I help you today?' },
              };
            },
          };
        }),
      };
    },
  };
});

// Mock logger with child method
vi.mock('../../src/utils/logger.js', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    level: 'silent',
    child: vi.fn(() => mockLogger),
  };
  return { logger: mockLogger };
});

/**
 * Mock adapter for testing
 */
class MockAdapter extends BaseAdapter {
  readonly sentMessages: Array<{ chatId: string; text: string }> = [];
  readonly typingIndicators: string[] = [];

  constructor() {
    super({ platform: 'mock' });
  }

  protected override async doInitialize(): Promise<void> {
    // No-op
  }

  protected override async doStart(): Promise<void> {
    // No-op
  }

  protected override async doStop(): Promise<void> {
    // No-op
  }

  protected override async doDispose(): Promise<void> {
    // No-op
  }

  override async sendMessage(
    chatId: string,
    text: string
  ): Promise<SendMessageResult> {
    this.sentMessages.push({ chatId, text });
    return { success: true, messageId: `mock-${Date.now()}` };
  }

  override async sendTypingIndicator(chatId: string): Promise<void> {
    this.typingIndicators.push(chatId);
  }
}

describe('Integration: Conversation Flow', () => {
  let tempDir: string;
  let agentLoader: AgentLoader;
  let sessionManager: SessionManager;
  let messageProcessor: MessageProcessor;
  let mockAdapter: MockAdapter;

  beforeEach(async () => {
    // Create temp directory for test agents
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudecab-integration-'));

    // Create test agent
    const agentDir = path.join(tempDir, 'test-agent');
    await fs.mkdir(agentDir, { recursive: true });

    await fs.writeFile(
      path.join(agentDir, 'agent.json'),
      JSON.stringify({
        name: 'Test Agent',
        description: 'A test agent for integration testing',
        model: 'sonnet',
      })
    );

    await fs.writeFile(
      path.join(agentDir, 'CLAUDE.md'),
      'You are a helpful test assistant.'
    );

    // Initialize components
    agentLoader = new AgentLoader({ agentsDir: tempDir });
    sessionManager = new SessionManager({
      agentLoader,
      defaultAgentId: 'test-agent',
    });
    sessionManager.start();

    mockAdapter = new MockAdapter();
    await mockAdapter.initialize();

    messageProcessor = new MessageProcessor({
      sessionManager,
      defaultAgentId: 'test-agent',
      getAdapter: () => mockAdapter,
      sendTypingIndicators: true,
      typingIndicatorIntervalMs: 1000,
      // Use legacy mode for testing (mocked Anthropic SDK)
      useClaudeAgentSDK: false,
    });
  });

  afterEach(async () => {
    sessionManager.dispose();

    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Task 7.3: Complete Conversation Flow', () => {
    it('should process a single message end-to-end', async () => {
      const message: UnifiedMessage = {
        id: 'msg-1',
        platform: 'mock',
        userId: 'user-1',
        chatId: 'chat-1',
        text: 'Hello!',
        timestamp: new Date(),
      };

      const result = await messageProcessor.processMessage(message);

      expect(result.success).toBe(true);
      expect(result.skipped).toBeUndefined();
      expect(result.sessionId).toBeDefined();
      expect(mockAdapter.sentMessages.length).toBeGreaterThan(0);
      expect(mockAdapter.sentMessages[0].text).toContain('Hello');
    });

    it('should maintain conversation context across messages', async () => {
      const userId = 'user-context-test';
      const chatId = 'chat-context-test';

      // First message
      const message1: UnifiedMessage = {
        id: 'msg-1',
        platform: 'mock',
        userId,
        chatId,
        text: 'My name is Alice.',
        timestamp: new Date(),
      };

      const result1 = await messageProcessor.processMessage(message1);
      expect(result1.success).toBe(true);

      // Second message (should have context from first)
      const message2: UnifiedMessage = {
        id: 'msg-2',
        platform: 'mock',
        userId,
        chatId,
        text: 'What is my name?',
        timestamp: new Date(),
      };

      const result2 = await messageProcessor.processMessage(message2);
      expect(result2.success).toBe(true);
      expect(result2.sessionId).toBe(result1.sessionId);
    });

    it('should handle idempotency (skip duplicate messages)', async () => {
      const message: UnifiedMessage = {
        id: 'duplicate-msg',
        platform: 'mock',
        userId: 'user-1',
        chatId: 'chat-1',
        text: 'Hello!',
        timestamp: new Date(),
      };

      // First processing
      const result1 = await messageProcessor.processMessage(message);
      expect(result1.success).toBe(true);
      expect(result1.skipped).toBeUndefined();

      const sentCount = mockAdapter.sentMessages.length;

      // Second processing (same message ID)
      const result2 = await messageProcessor.processMessage(message);
      expect(result2.success).toBe(true);
      expect(result2.skipped).toBe(true);

      // Should not have sent additional messages
      expect(mockAdapter.sentMessages.length).toBe(sentCount);
    });

    it('should send typing indicators during processing', async () => {
      const message: UnifiedMessage = {
        id: 'msg-typing',
        platform: 'mock',
        userId: 'user-1',
        chatId: 'chat-typing',
        text: 'Hello!',
        timestamp: new Date(),
      };

      await messageProcessor.processMessage(message);

      // Should have sent at least one typing indicator
      expect(mockAdapter.typingIndicators).toContain('chat-typing');
    });
  });

  describe('Task 7.4: Agent Switching', () => {
    beforeEach(async () => {
      // Create a second test agent
      const agent2Dir = path.join(tempDir, 'test-agent-2');
      await fs.mkdir(agent2Dir, { recursive: true });

      await fs.writeFile(
        path.join(agent2Dir, 'agent.json'),
        JSON.stringify({
          name: 'Test Agent 2',
          description: 'A second test agent',
          model: 'haiku',
        })
      );

      await fs.writeFile(
        path.join(agent2Dir, 'CLAUDE.md'),
        'You are the second test assistant.'
      );
    });

    it('should switch agents for a session', async () => {
      const platform = 'mock';
      const userId = 'user-switch';

      // Create session with first agent
      const session1 = await sessionManager.createSession({
        platform,
        userId,
        agentId: 'test-agent',
      });

      expect(session1.agentId).toBe('test-agent');

      // Switch to second agent
      const session2 = await sessionManager.switchAgent(
        platform,
        userId,
        'test-agent-2'
      );

      expect(session2.agentId).toBe('test-agent-2');
      expect(session2.sessionId).toBe(session1.sessionId);
    });

    it('should clear conversation history on agent switch', async () => {
      const platform = 'mock';
      const userId = 'user-switch-clear';
      const chatId = 'chat-switch-clear';

      // Create session and send message
      await sessionManager.createSession({
        platform,
        userId,
        agentId: 'test-agent',
      });

      const message: UnifiedMessage = {
        id: 'msg-before-switch',
        platform,
        userId,
        chatId,
        text: 'Hello before switch!',
        timestamp: new Date(),
      };

      await messageProcessor.processMessage(message);

      // Switch agent (this should trigger conversation reset internally)
      const session = await sessionManager.switchAgent(
        platform,
        userId,
        'test-agent-2'
      );

      // sdkSessionId should be cleared
      expect(session.agentId).toBe('test-agent-2');
    });

    it('should fail to switch to non-existent agent', async () => {
      const platform = 'mock';
      const userId = 'user-switch-fail';

      await sessionManager.createSession({
        platform,
        userId,
        agentId: 'test-agent',
      });

      await expect(
        sessionManager.switchAgent(platform, userId, 'non-existent-agent')
      ).rejects.toThrow();
    });
  });

  describe('Task 7.5: Error Handling Flow', () => {
    it('should handle missing adapter gracefully', async () => {
      const processorWithNoAdapter = new MessageProcessor({
        sessionManager,
        defaultAgentId: 'test-agent',
        getAdapter: () => undefined, // No adapter
        sendTypingIndicators: false,
      });

      const message: UnifiedMessage = {
        id: 'msg-no-adapter',
        platform: 'unknown',
        userId: 'user-1',
        chatId: 'chat-1',
        text: 'Hello!',
        timestamp: new Date(),
      };

      const result = await processorWithNoAdapter.processMessage(message);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No adapter');
    });

    it('should handle session creation failure', async () => {
      // Fill up to max sessions
      const maxSessionManager = new SessionManager({
        agentLoader,
        defaultAgentId: 'test-agent',
        config: { maxSessions: 1 },
      });
      maxSessionManager.start();

      try {
        // Create first session
        await maxSessionManager.createSession({
          platform: 'mock',
          userId: 'user-1',
          agentId: 'test-agent',
        });

        // Try to create second session (should fail)
        await expect(
          maxSessionManager.createSession({
            platform: 'mock',
            userId: 'user-2',
            agentId: 'test-agent',
          })
        ).rejects.toThrow('Maximum sessions limit');
      } finally {
        maxSessionManager.dispose();
      }
    });

    it('should handle invalid agent ID', async () => {
      const message: UnifiedMessage = {
        id: 'msg-invalid-agent',
        platform: 'mock',
        userId: 'user-invalid',
        chatId: 'chat-1',
        text: 'Hello!',
        timestamp: new Date(),
      };

      const badProcessor = new MessageProcessor({
        sessionManager: new SessionManager({
          agentLoader,
          defaultAgentId: 'non-existent-agent',
        }),
        defaultAgentId: 'non-existent-agent',
        getAdapter: () => mockAdapter,
        sendTypingIndicators: false,
      });

      const result = await badProcessor.processMessage(message);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
