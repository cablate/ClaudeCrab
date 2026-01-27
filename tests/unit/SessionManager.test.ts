import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionManager } from '../../src/core/SessionManager.js';
import { AgentLoader } from '../../src/core/AgentLoader.js';
import { getEventBus, resetEventBus } from '../../src/core/EventBus.js';
import { SessionError } from '../../src/types/errors.js';

describe('SessionManager', () => {
  let tempDir: string;
  let agentLoader: AgentLoader;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    resetEventBus();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudecab-session-'));

    // Create a test agent
    const agentDir = path.join(tempDir, 'test-agent');
    await fs.mkdir(agentDir);
    await fs.writeFile(
      path.join(agentDir, 'agent.json'),
      JSON.stringify({
        name: 'Test Agent',
        model: 'sonnet',
      })
    );
    await fs.writeFile(
      path.join(agentDir, 'CLAUDE.md'),
      'You are a test agent.'
    );

    agentLoader = new AgentLoader({ agentsDir: tempDir });
    sessionManager = new SessionManager({
      agentLoader,
      config: {
        sessionTimeoutMs: 60000,
        cleanupIntervalMs: 30000,
        maxSessions: 100,
        maxProcessedMessageIds: 50,
      },
    });
  });

  afterEach(async () => {
    sessionManager.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('createSession', () => {
    it('should create a new session', async () => {
      const session = await sessionManager.createSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      expect(session.sessionId).toBeDefined();
      expect(session.platform).toBe('telegram');
      expect(session.userId).toBe('user123');
      expect(session.agentId).toBe('test-agent');
      expect(session.state).toBe('idle');
    });

    it('should return existing session if already exists', async () => {
      const session1 = await sessionManager.createSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      const session2 = await sessionManager.createSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      expect(session1.sessionId).toBe(session2.sessionId);
    });

    it('should throw error when max sessions reached', async () => {
      const limitedManager = new SessionManager({
        agentLoader,
        config: { maxSessions: 2 },
      });

      await limitedManager.createSession({
        platform: 'telegram',
        userId: 'user1',
        agentId: 'test-agent',
      });

      await limitedManager.createSession({
        platform: 'telegram',
        userId: 'user2',
        agentId: 'test-agent',
      });

      await expect(
        limitedManager.createSession({
          platform: 'telegram',
          userId: 'user3',
          agentId: 'test-agent',
        })
      ).rejects.toThrow(SessionError);

      limitedManager.dispose();
    });

    it('should throw error for non-existent agent', async () => {
      await expect(
        sessionManager.createSession({
          platform: 'telegram',
          userId: 'user123',
          agentId: 'non-existent',
        })
      ).rejects.toThrow(SessionError);
    });

    it('should emit session:created event', async () => {
      const eventHandler = vi.fn();
      getEventBus().on('session:created', eventHandler);

      await sessionManager.createSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      expect(eventHandler).toHaveBeenCalledTimes(1);
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: 'telegram',
          userId: 'user123',
        })
      );
    });
  });

  describe('getSession', () => {
    it('should return undefined for non-existent session', () => {
      const session = sessionManager.getSession('telegram', 'test-agent', 'unknown');
      expect(session).toBeUndefined();
    });

    it('should return session and update lastActiveAt', async () => {
      await sessionManager.createSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      const before = new Date();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const session = sessionManager.getSession('telegram', 'test-agent', 'user123');

      expect(session).toBeDefined();
      expect(session!.lastActiveAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime()
      );
    });
  });

  describe('getOrCreateSession', () => {
    it('should return existing session', async () => {
      const created = await sessionManager.createSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      const retrieved = await sessionManager.getOrCreateSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      expect(retrieved.sessionId).toBe(created.sessionId);
    });

    it('should create new session if not exists', async () => {
      const session = await sessionManager.getOrCreateSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      expect(session.sessionId).toBeDefined();
    });

    it('should throw error if no agent specified', async () => {
      await expect(
        sessionManager.getOrCreateSession({
          platform: 'telegram',
          userId: 'user123',
        })
      ).rejects.toThrow(SessionError);
    });
  });

  describe('updateState', () => {
    it('should update session state', async () => {
      await sessionManager.createSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      sessionManager.updateState('telegram', 'test-agent', 'user123', 'processing');

      const session = sessionManager.getSession('telegram', 'test-agent', 'user123');
      expect(session?.state).toBe('processing');
    });

    it('should emit session:stateChanged event', async () => {
      await sessionManager.createSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      const eventHandler = vi.fn();
      getEventBus().on('session:stateChanged', eventHandler);

      sessionManager.updateState('telegram', 'test-agent', 'user123', 'processing');

      expect(eventHandler).toHaveBeenCalledWith({
        sessionId: expect.any(String),
        previousState: 'idle',
        newState: 'processing',
      });
    });

    it('should throw error for non-existent session', () => {
      expect(() =>
        sessionManager.updateState('telegram', 'test-agent', 'unknown', 'processing')
      ).toThrow(SessionError);
    });
  });

  describe('closeSession', () => {
    it('should close existing session', async () => {
      await sessionManager.createSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      const result = sessionManager.closeSession('telegram', 'test-agent', 'user123');

      expect(result).toBe(true);
      expect(sessionManager.hasSession('telegram', 'test-agent', 'user123')).toBe(false);
    });

    it('should return false for non-existent session', () => {
      const result = sessionManager.closeSession('telegram', 'test-agent', 'unknown');
      expect(result).toBe(false);
    });

    it('should emit session:closed event', async () => {
      await sessionManager.createSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      const eventHandler = vi.fn();
      getEventBus().on('session:closed', eventHandler);

      sessionManager.closeSession('telegram', 'test-agent', 'user123', 'user_request');

      expect(eventHandler).toHaveBeenCalledWith({
        sessionId: expect.any(String),
        reason: 'user_request',
        platform: 'telegram',
        userId: 'user123',
      });
    });
  });

  describe('idempotency', () => {
    it('should track processed message IDs', async () => {
      await sessionManager.createSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      expect(
        sessionManager.isMessageProcessed('telegram', 'test-agent', 'user123', 'msg1')
      ).toBe(false);

      sessionManager.markMessageProcessed('telegram', 'test-agent', 'user123', 'msg1');

      expect(
        sessionManager.isMessageProcessed('telegram', 'test-agent', 'user123', 'msg1')
      ).toBe(true);
    });

    it('should trim old message IDs when limit exceeded', async () => {
      const limitedManager = new SessionManager({
        agentLoader,
        config: { maxProcessedMessageIds: 3 },
      });

      await limitedManager.createSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      limitedManager.markMessageProcessed('telegram', 'test-agent', 'user123', 'msg1');
      limitedManager.markMessageProcessed('telegram', 'test-agent', 'user123', 'msg2');
      limitedManager.markMessageProcessed('telegram', 'test-agent', 'user123', 'msg3');
      limitedManager.markMessageProcessed('telegram', 'test-agent', 'user123', 'msg4');

      // msg1 should be trimmed
      expect(
        limitedManager.isMessageProcessed('telegram', 'test-agent', 'user123', 'msg1')
      ).toBe(false);
      expect(
        limitedManager.isMessageProcessed('telegram', 'test-agent', 'user123', 'msg4')
      ).toBe(true);

      limitedManager.dispose();
    });
  });

  describe('locking', () => {
    it('should acquire and release lock', async () => {
      await sessionManager.createSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      const release = await sessionManager.acquireLock('telegram', 'test-agent', 'user123');
      expect(release).toBeInstanceOf(Function);
      release();
    });

    it('should execute function with lock', async () => {
      await sessionManager.createSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      const result = await sessionManager.withLock(
        'telegram',
        'test-agent',
        'user123',
        async () => {
          return 'result';
        }
      );

      expect(result).toBe('result');
    });

    it('should throw error when locking non-existent session', async () => {
      await expect(
        sessionManager.acquireLock('telegram', 'test-agent', 'unknown')
      ).rejects.toThrow(SessionError);
    });
  });

  describe('cleanup', () => {
    it('should cleanup expired sessions', async () => {
      const shortTimeoutManager = new SessionManager({
        agentLoader,
        config: { sessionTimeoutMs: 10 },
      });

      await shortTimeoutManager.createSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      // Wait for session to expire
      await new Promise((resolve) => setTimeout(resolve, 50));

      const cleaned = await shortTimeoutManager.cleanupExpired();
      expect(cleaned).toBe(1);
      expect(shortTimeoutManager.getSessionCount()).toBe(0);

      shortTimeoutManager.dispose();
    });

    it('should emit session:closed event on cleanup', async () => {
      const shortTimeoutManager = new SessionManager({
        agentLoader,
        config: { sessionTimeoutMs: 10 },
      });

      await shortTimeoutManager.createSession({
        platform: 'telegram',
        userId: 'user123',
        agentId: 'test-agent',
      });

      const eventHandler = vi.fn();
      getEventBus().on('session:closed', eventHandler);

      await new Promise((resolve) => setTimeout(resolve, 50));
      await shortTimeoutManager.cleanupExpired();

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'timeout',
        })
      );

      shortTimeoutManager.dispose();
    });
  });

  describe('getAllSessions', () => {
    it('should return all active sessions', async () => {
      await sessionManager.createSession({
        platform: 'telegram',
        userId: 'user1',
        agentId: 'test-agent',
      });

      await sessionManager.createSession({
        platform: 'telegram',
        userId: 'user2',
        agentId: 'test-agent',
      });

      const sessions = sessionManager.getAllSessions();
      expect(sessions).toHaveLength(2);
    });
  });

  describe('getSessionsByPlatform', () => {
    it('should return sessions for specific platform', async () => {
      await sessionManager.createSession({
        platform: 'telegram',
        userId: 'user1',
        agentId: 'test-agent',
      });

      await sessionManager.createSession({
        platform: 'discord',
        userId: 'user2',
        agentId: 'test-agent',
      });

      const telegramSessions = sessionManager.getSessionsByPlatform('telegram');
      expect(telegramSessions).toHaveLength(1);
      expect(telegramSessions[0].platform).toBe('telegram');
    });
  });

  describe('start/stop', () => {
    it('should start and stop cleanup interval', () => {
      sessionManager.start();
      // Should not throw when called multiple times
      sessionManager.start();

      sessionManager.stop();
      // Should not throw when called multiple times
      sessionManager.stop();
    });
  });
});

describe('SessionManager Concurrency', () => {
  let tempDir: string;
  let agentLoader: AgentLoader;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    resetEventBus();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudecab-concurrency-'));

    const agentDir = path.join(tempDir, 'test-agent');
    await fs.mkdir(agentDir);
    await fs.writeFile(
      path.join(agentDir, 'agent.json'),
      JSON.stringify({ name: 'Test Agent' })
    );

    agentLoader = new AgentLoader({ agentsDir: tempDir });
    sessionManager = new SessionManager({ agentLoader });
  });

  afterEach(async () => {
    sessionManager.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should serialize concurrent operations with lock', async () => {
    await sessionManager.createSession({
      platform: 'telegram',
      userId: 'user123',
      agentId: 'test-agent',
    });

    const results: number[] = [];

    const task1 = sessionManager.withLock('telegram', 'test-agent', 'user123', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      results.push(1);
      return 1;
    });

    const task2 = sessionManager.withLock('telegram', 'test-agent', 'user123', async () => {
      results.push(2);
      return 2;
    });

    await Promise.all([task1, task2]);

    // Task 1 should complete before task 2 starts
    expect(results[0]).toBe(1);
    expect(results[1]).toBe(2);
  });

  it('should allow parallel operations on different sessions', async () => {
    await sessionManager.createSession({
      platform: 'telegram',
      userId: 'user1',
      agentId: 'test-agent',
    });

    await sessionManager.createSession({
      platform: 'telegram',
      userId: 'user2',
      agentId: 'test-agent',
    });

    const startTime = Date.now();

    await Promise.all([
      sessionManager.withLock('telegram', 'test-agent', 'user1', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }),
      sessionManager.withLock('telegram', 'test-agent', 'user2', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }),
    ]);

    const elapsed = Date.now() - startTime;
    // Should run in parallel, so total time should be ~50ms, not ~100ms
    expect(elapsed).toBeLessThan(100);
  });
});
