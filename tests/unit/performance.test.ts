import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentLoader } from '../../src/core/AgentLoader.js';
import { resetEventBus } from '../../src/core/EventBus.js';

describe('Performance Tests', () => {
  let tempDir: string;
  let loader: AgentLoader;

  beforeEach(async () => {
    resetEventBus();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudecab-perf-'));
    loader = new AgentLoader({ agentsDir: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
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
          description: `Test agent number ${i}`,
          model: 'sonnet',
          settings: {
            maxTurns: 10,
            permissionMode: 'default',
          },
        })
      );
      await fs.writeFile(
        path.join(agentDir, 'CLAUDE.md'),
        `You are test agent ${i}. Be helpful and concise.`
      );
    }

    // Measure load time
    const startTime = performance.now();
    const agents = await loader.loadAllAgents();
    const endTime = performance.now();

    const loadTime = endTime - startTime;

    expect(agents).toHaveLength(10);
    expect(loadTime).toBeLessThan(1000); // Less than 1 second

    console.log(`Loaded 10 agents in ${loadTime.toFixed(2)}ms`);
  });

  it('should scan agents directory quickly', async () => {
    // Create 20 agents
    for (let i = 0; i < 20; i++) {
      const agentDir = path.join(tempDir, `agent-${i}`);
      await fs.mkdir(agentDir);
      await fs.writeFile(
        path.join(agentDir, 'agent.json'),
        JSON.stringify({ name: `Agent ${i}` })
      );
    }

    // Also create some non-agent directories
    for (let i = 0; i < 5; i++) {
      await fs.mkdir(path.join(tempDir, `not-agent-${i}`));
    }

    const startTime = performance.now();
    const agentIds = await loader.scanAgents();
    const endTime = performance.now();

    const scanTime = endTime - startTime;

    expect(agentIds).toHaveLength(20);
    expect(scanTime).toBeLessThan(500); // Less than 500ms

    console.log(`Scanned 25 directories in ${scanTime.toFixed(2)}ms`);
  });

  it('should cache agents for fast retrieval', async () => {
    // Create test agent
    const agentDir = path.join(tempDir, 'cached-agent');
    await fs.mkdir(agentDir);
    await fs.writeFile(
      path.join(agentDir, 'agent.json'),
      JSON.stringify({ name: 'Cached Agent' })
    );

    // First load (hits filesystem)
    const startFirst = performance.now();
    await loader.loadAgent('cached-agent');
    const endFirst = performance.now();
    const firstLoadTime = endFirst - startFirst;

    // Second retrieval (from cache)
    const startSecond = performance.now();
    const cachedAgent = loader.get('cached-agent');
    const endSecond = performance.now();
    const cacheRetrievalTime = endSecond - startSecond;

    expect(cachedAgent).toBeDefined();
    expect(cacheRetrievalTime).toBeLessThan(firstLoadTime);
    expect(cacheRetrievalTime).toBeLessThan(1); // Cache retrieval should be < 1ms

    console.log(`First load: ${firstLoadTime.toFixed(2)}ms`);
    console.log(`Cache retrieval: ${cacheRetrievalTime.toFixed(4)}ms`);
  });
});
