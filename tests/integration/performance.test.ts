import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentLoader } from '../../src/core/AgentLoader.js';
import { SessionManager } from '../../src/core/SessionManager.js';
import { resetEventBus } from '../../src/core/EventBus.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        stream: vi.fn().mockImplementation(() => {
          return {
            [Symbol.asyncIterator]: async function* () {
              yield {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: 'Test response' },
              };
            },
          };
        }),
      };
    },
  };
});

// Mock logger
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

describe('Performance Tests (Task 7.7-7.9)', () => {
  let tempDir: string;
  let agentLoader: AgentLoader;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    resetEventBus();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudecab-perf-int-'));

    // Create test agent
    const agentDir = path.join(tempDir, 'perf-agent');
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(
      path.join(agentDir, 'agent.json'),
      JSON.stringify({
        name: 'Performance Test Agent',
        model: 'sonnet',
      })
    );
    await fs.writeFile(
      path.join(agentDir, 'CLAUDE.md'),
      'You are a performance test agent.'
    );

    agentLoader = new AgentLoader({ agentsDir: tempDir });
    sessionManager = new SessionManager({
      agentLoader,
      config: {
        maxSessions: 2000,
      },
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

  describe('Task 7.7: Agent Loading Performance', () => {
    it('should load agent in less than 1 second', async () => {
      const startTime = performance.now();
      const agent = await agentLoader.loadAgent('perf-agent');
      const endTime = performance.now();

      const loadTime = endTime - startTime;

      expect(agent).toBeDefined();
      expect(agent.id).toBe('perf-agent');
      expect(loadTime).toBeLessThan(1000);

      console.log(`Single agent load time: ${loadTime.toFixed(2)}ms`);
    });

    it('should load 10 agents in less than 1 second', async () => {
      // Create 10 test agents
      for (let i = 0; i < 10; i++) {
        const agentDir = path.join(tempDir, `agent-${i}`);
        await fs.mkdir(agentDir);
        await fs.writeFile(
          path.join(agentDir, 'agent.json'),
          JSON.stringify({
            name: `Agent ${i}`,
            model: 'sonnet',
          })
        );
        await fs.writeFile(
          path.join(agentDir, 'CLAUDE.md'),
          `System prompt for agent ${i}`
        );
      }

      const startTime = performance.now();
      const agents = await agentLoader.loadAllAgents();
      const endTime = performance.now();

      const loadTime = endTime - startTime;

      // Should load 11 agents (perf-agent + 10 new ones)
      expect(agents.length).toBeGreaterThanOrEqual(10);
      expect(loadTime).toBeLessThan(1000);

      console.log(`Loaded ${agents.length} agents in ${loadTime.toFixed(2)}ms`);
    });
  });

  describe('Task 7.8: Message Processing Latency', () => {
    it('should create session in less than 200ms', async () => {
      const startTime = performance.now();
      const session = await sessionManager.createSession({
        platform: 'perf-test',
        userId: 'latency-user',
        agentId: 'perf-agent',
      });
      const endTime = performance.now();

      const latency = endTime - startTime;

      expect(session).toBeDefined();
      expect(latency).toBeLessThan(200);

      console.log(`Session creation latency: ${latency.toFixed(2)}ms`);
    });

    it('should acquire and release lock quickly', async () => {
      // Create session first
      await sessionManager.createSession({
        platform: 'perf-test',
        userId: 'lock-user',
        agentId: 'perf-agent',
      });

      const startTime = performance.now();
      const release = await sessionManager.acquireLock('perf-test', 'perf-agent', 'lock-user');
      const acquireTime = performance.now() - startTime;

      const releaseStart = performance.now();
      release();
      const releaseTime = performance.now() - releaseStart;

      expect(acquireTime).toBeLessThan(50);
      expect(releaseTime).toBeLessThan(1);

      console.log(`Lock acquire time: ${acquireTime.toFixed(2)}ms`);
      console.log(`Lock release time: ${releaseTime.toFixed(4)}ms`);
    });

    it('should handle state updates quickly', async () => {
      // Create session
      await sessionManager.createSession({
        platform: 'perf-test',
        userId: 'state-user',
        agentId: 'perf-agent',
      });

      const iterations = 100;
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        sessionManager.updateState(
          'perf-test',
          'perf-agent',
          'state-user',
          i % 2 === 0 ? 'processing' : 'idle'
        );
      }

      const endTime = performance.now();
      const avgLatency = (endTime - startTime) / iterations;

      expect(avgLatency).toBeLessThan(1); // < 1ms per update

      console.log(`Avg state update latency: ${avgLatency.toFixed(4)}ms`);
    });
  });

  describe('Task 7.9: Memory Usage', () => {
    it('should handle 1000 sessions within memory limits', async () => {
      const sessionCount = 1000;

      // Get initial memory usage
      const initialMemory = process.memoryUsage();

      // Create many sessions
      const startTime = performance.now();
      for (let i = 0; i < sessionCount; i++) {
        await sessionManager.createSession({
          platform: 'memory-test',
          userId: `user-${i}`,
          agentId: 'perf-agent',
        });
      }
      const endTime = performance.now();

      // Get final memory usage
      const finalMemory = process.memoryUsage();

      // Calculate memory increase
      const heapUsedIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const heapUsedMB = heapUsedIncrease / (1024 * 1024);

      // Verify all sessions created
      expect(sessionManager.getSessionCount()).toBe(sessionCount);

      // Memory should be less than 500MB for 1000 sessions
      expect(heapUsedMB).toBeLessThan(500);

      console.log(`Created ${sessionCount} sessions in ${(endTime - startTime).toFixed(2)}ms`);
      console.log(`Memory increase: ${heapUsedMB.toFixed(2)}MB`);
      console.log(`Memory per session: ${((heapUsedMB * 1024) / sessionCount).toFixed(2)}KB`);
    });

    it('should efficiently cleanup expired sessions', async () => {
      const sessionCount = 100;

      // Create sessions with short timeout manager
      const shortTimeoutManager = new SessionManager({
        agentLoader,
        config: {
          sessionTimeoutMs: 10,
          maxSessions: 2000,
        },
      });

      try {
        // Create sessions
        for (let i = 0; i < sessionCount; i++) {
          await shortTimeoutManager.createSession({
            platform: 'cleanup-test',
            userId: `cleanup-user-${i}`,
            agentId: 'perf-agent',
          });
        }

        expect(shortTimeoutManager.getSessionCount()).toBe(sessionCount);

        // Wait for timeout
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Measure cleanup time
        const startTime = performance.now();
        const cleaned = await shortTimeoutManager.cleanupExpired();
        const endTime = performance.now();

        const cleanupTime = endTime - startTime;

        expect(cleaned).toBe(sessionCount);
        expect(shortTimeoutManager.getSessionCount()).toBe(0);
        expect(cleanupTime).toBeLessThan(100); // < 100ms for cleanup

        console.log(`Cleaned ${cleaned} sessions in ${cleanupTime.toFixed(2)}ms`);
      } finally {
        shortTimeoutManager.dispose();
      }
    });

    it('should not leak memory on session close', async () => {
      const iterations = 100;

      // Get baseline memory
      global.gc?.(); // Force GC if available
      const baselineMemory = process.memoryUsage().heapUsed;

      // Create and close sessions repeatedly
      for (let i = 0; i < iterations; i++) {
        await sessionManager.createSession({
          platform: 'leak-test',
          userId: `leak-user-${i}`,
          agentId: 'perf-agent',
        });
        sessionManager.closeSession('leak-test', 'perf-agent', `leak-user-${i}`);
      }

      // Check no sessions remain
      expect(sessionManager.getSessionCount()).toBe(0);

      // Memory shouldn't grow significantly (allow some variance)
      global.gc?.();
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowthMB = (finalMemory - baselineMemory) / (1024 * 1024);

      // Should not grow more than 50MB after all sessions closed
      expect(memoryGrowthMB).toBeLessThan(50);

      console.log(`Memory growth after ${iterations} create/close cycles: ${memoryGrowthMB.toFixed(2)}MB`);
    });
  });

  describe('Concurrent Performance', () => {
    it('should handle concurrent session creation efficiently', async () => {
      const concurrentCount = 50;

      const startTime = performance.now();
      const promises = Array.from({ length: concurrentCount }, (_, i) =>
        sessionManager.createSession({
          platform: 'concurrent-perf',
          userId: `concurrent-user-${i}`,
          agentId: 'perf-agent',
        })
      );

      await Promise.all(promises);
      const endTime = performance.now();

      const totalTime = endTime - startTime;
      const avgTime = totalTime / concurrentCount;

      expect(sessionManager.getSessionCount()).toBe(concurrentCount);
      expect(avgTime).toBeLessThan(50); // Average < 50ms per session

      console.log(`Created ${concurrentCount} sessions concurrently in ${totalTime.toFixed(2)}ms`);
      console.log(`Average time per session: ${avgTime.toFixed(2)}ms`);
    });
  });
});
