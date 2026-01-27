import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentLoader } from '../../src/core/AgentLoader.js';
import { SessionManager } from '../../src/core/SessionManager.js';
import { MessageProcessor } from '../../src/core/MessageProcessor.js';
import { BaseAdapter } from '../../src/adapters/BaseAdapter.js';
import type { UnifiedMessage, SendMessageResult } from '../../src/adapters/types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock Anthropic SDK with delay to simulate real API calls
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        stream: vi.fn().mockImplementation(() => {
          // Return an async iterable with small delay
          return {
            [Symbol.asyncIterator]: async function* () {
              await new Promise((resolve) => setTimeout(resolve, 10));
              yield {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: 'Response ' },
              };
              yield {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: 'from Claude' },
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
 * Mock adapter for concurrent testing
 */
class ConcurrentMockAdapter extends BaseAdapter {
  readonly messageLog: Array<{
    chatId: string;
    text: string;
    timestamp: number;
  }> = [];

  constructor(agentId = 'test-agent') {
    super({ platform: 'concurrent-mock', agentId });
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
    this.messageLog.push({ chatId, text, timestamp: Date.now() });
    return { success: true, messageId: `concurrent-${Date.now()}` };
  }

  override async sendTypingIndicator(): Promise<void> {
    // No-op for concurrent tests
  }
}

describe('Integration: Concurrent Users (Task 7.6)', () => {
  let tempDir: string;
  let agentLoader: AgentLoader;
  let sessionManager: SessionManager;
  let messageProcessor: MessageProcessor;
  let mockAdapter: ConcurrentMockAdapter;

  beforeEach(async () => {
    // Create temp directory for test agents
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'claudecab-concurrent-')
    );

    // Create test agent
    const agentDir = path.join(tempDir, 'test-agent');
    await fs.mkdir(agentDir, { recursive: true });

    await fs.writeFile(
      path.join(agentDir, 'agent.json'),
      JSON.stringify({
        name: 'Concurrent Test Agent',
        description: 'An agent for concurrent testing',
        model: 'sonnet',
      })
    );

    await fs.writeFile(
      path.join(agentDir, 'CLAUDE.md'),
      'You are a concurrent test assistant.'
    );

    // Initialize components
    agentLoader = new AgentLoader({ agentsDir: tempDir });
    sessionManager = new SessionManager({
      agentLoader,
      config: {
        maxSessions: 100, // Allow many sessions for concurrent test
      },
    });
    sessionManager.start();

    mockAdapter = new ConcurrentMockAdapter();
    await mockAdapter.initialize();

    messageProcessor = new MessageProcessor({
      sessionManager,
      getAdapter: (_platform: string, _agentId: string) => mockAdapter,
      sendTypingIndicators: false,
      // Use legacy mode for testing (mocked Anthropic SDK)
      useClaudeAgentSDK: false,
    });
  });

  afterEach(async () => {
    sessionManager.dispose();

    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should handle 10 concurrent users sending messages', async () => {
    const userCount = 10;
    const messagesPerUser = 2;

    // Create messages for all users
    const allMessages: UnifiedMessage[] = [];
    for (let i = 0; i < userCount; i++) {
      for (let j = 0; j < messagesPerUser; j++) {
        allMessages.push({
          id: `msg-user${i}-${j}`,
          platform: 'concurrent-mock',
          userId: `user-${i}`,
          chatId: `chat-${i}`,
          text: `Message ${j} from user ${i}`,
          timestamp: new Date(),
        });
      }
    }

    // Process all messages concurrently
    const startTime = Date.now();
    const results = await Promise.all(
      allMessages.map((msg) => messageProcessor.processMessage(msg, 'test-agent'))
    );
    const endTime = Date.now();

    // Verify all messages were processed successfully
    const successfulResults = results.filter((r) => r.success && !r.skipped);
    expect(successfulResults.length).toBe(userCount * messagesPerUser);

    // Verify each user got their responses
    const responsesByChat = new Map<string, number>();
    for (const log of mockAdapter.messageLog) {
      const count = responsesByChat.get(log.chatId) ?? 0;
      responsesByChat.set(log.chatId, count + 1);
    }

    for (let i = 0; i < userCount; i++) {
      const chatId = `chat-${i}`;
      const count = responsesByChat.get(chatId) ?? 0;
      expect(count).toBe(messagesPerUser);
    }

    // Log timing info
    console.log(
      `Processed ${userCount * messagesPerUser} messages in ${endTime - startTime}ms`
    );
  });

  it('should maintain session isolation between concurrent users', async () => {
    const userCount = 5;

    // Create sessions for all users concurrently
    const sessionPromises = Array.from({ length: userCount }, (_, i) =>
      sessionManager.createSession({
        platform: 'concurrent-mock',
        userId: `isolated-user-${i}`,
        agentId: 'test-agent',
      })
    );

    const sessions = await Promise.all(sessionPromises);

    // Verify each session is unique
    const sessionIds = sessions.map((s) => s.sessionId);
    const uniqueIds = new Set(sessionIds);
    expect(uniqueIds.size).toBe(userCount);

    // Verify total session count
    expect(sessionManager.getSessionCount()).toBe(userCount);

    // Verify each session has correct user ID
    for (let i = 0; i < userCount; i++) {
      expect(sessions[i].userId).toBe(`isolated-user-${i}`);
      expect(sessions[i].platform).toBe('concurrent-mock');
    }
  });

  it('should handle rapid messages from same user (queue/lock)', async () => {
    const userId = 'rapid-user';
    const messageCount = 5;

    // Create session first
    await sessionManager.createSession({
      platform: 'concurrent-mock',
      userId,
      agentId: 'test-agent',
    });

    // Send messages rapidly (different IDs to avoid idempotency skip)
    const messages: UnifiedMessage[] = Array.from(
      { length: messageCount },
      (_, i) => ({
        id: `rapid-msg-${i}`,
        platform: 'concurrent-mock',
        userId,
        chatId: 'rapid-chat',
        text: `Rapid message ${i}`,
        timestamp: new Date(),
      })
    );

    // Process all messages concurrently
    const results = await Promise.all(
      messages.map((msg) => messageProcessor.processMessage(msg, 'test-agent'))
    );

    // All should succeed
    const successCount = results.filter((r) => r.success).length;
    expect(successCount).toBe(messageCount);

    // Session should still be in valid state
    const session = sessionManager.getSession('concurrent-mock', 'test-agent', userId);
    expect(session).toBeDefined();
    expect(session?.state).toBe('idle');
  });

  it('should handle mixed operations (create, close, multi-agent) concurrently', async () => {
    // Create second agent
    const agent2Dir = path.join(tempDir, 'test-agent-2');
    await fs.mkdir(agent2Dir, { recursive: true });
    await fs.writeFile(
      path.join(agent2Dir, 'agent.json'),
      JSON.stringify({ name: 'Agent 2', model: 'haiku' })
    );
    await fs.writeFile(
      path.join(agent2Dir, 'CLAUDE.md'),
      'Second agent.'
    );

    // Create initial sessions with test-agent
    const createPromises = Array.from({ length: 5 }, (_, i) =>
      sessionManager.createSession({
        platform: 'concurrent-mock',
        userId: `mixed-user-${i}`,
        agentId: 'test-agent',
      })
    );

    await Promise.all(createPromises);

    // Mixed operations: close, create with different agents
    const operations = [
      // Close some sessions
      Promise.resolve(
        sessionManager.closeSession('concurrent-mock', 'test-agent', 'mixed-user-2')
      ),
      Promise.resolve(
        sessionManager.closeSession('concurrent-mock', 'test-agent', 'mixed-user-3')
      ),
      // Create new sessions with different agent
      sessionManager.createSession({
        platform: 'concurrent-mock',
        userId: 'mixed-user-new-1',
        agentId: 'test-agent',
      }),
      sessionManager.createSession({
        platform: 'concurrent-mock',
        userId: 'mixed-user-new-2',
        agentId: 'test-agent-2',
      }),
      // Same user, different agent (independent sessions)
      sessionManager.createSession({
        platform: 'concurrent-mock',
        userId: 'mixed-user-0',
        agentId: 'test-agent-2',
      }),
    ];

    await Promise.all(operations);

    // Verify final state
    const session0Agent1 = sessionManager.getSession('concurrent-mock', 'test-agent', 'mixed-user-0');
    expect(session0Agent1).toBeDefined();
    expect(session0Agent1?.agentId).toBe('test-agent');

    const session0Agent2 = sessionManager.getSession('concurrent-mock', 'test-agent-2', 'mixed-user-0');
    expect(session0Agent2).toBeDefined();
    expect(session0Agent2?.agentId).toBe('test-agent-2');

    const session2 = sessionManager.getSession('concurrent-mock', 'test-agent', 'mixed-user-2');
    expect(session2).toBeUndefined(); // Closed

    const sessionNew1 = sessionManager.getSession(
      'concurrent-mock',
      'test-agent',
      'mixed-user-new-1'
    );
    expect(sessionNew1).toBeDefined();
  });

  it('should handle session timeout during concurrent operations', async () => {
    // Create manager with very short timeout
    const shortTimeoutManager = new SessionManager({
      agentLoader,
      config: {
        sessionTimeoutMs: 10, // Very short timeout
        cleanupIntervalMs: 5000, // Long interval - we'll manually cleanup
      },
    });
    // Don't start auto-cleanup, we'll call it manually
    // shortTimeoutManager.start();

    try {
      // Create session
      const session = await shortTimeoutManager.createSession({
        platform: 'concurrent-mock',
        userId: 'timeout-user',
        agentId: 'test-agent',
      });

      expect(session).toBeDefined();

      // Wait for session to expire (more than 10ms)
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Manually run cleanup
      const cleaned = await shortTimeoutManager.cleanupExpired();

      // Session should be cleaned up
      expect(cleaned).toBe(1);
      expect(
        shortTimeoutManager.getSession('concurrent-mock', 'test-agent', 'timeout-user')
      ).toBeUndefined();
    } finally {
      shortTimeoutManager.dispose();
    }
  });
});
