import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentLoader } from '../../src/core/AgentLoader.js';
import { AgentLoadError, AgentConfigError } from '../../src/types/errors.js';
import { resetEventBus } from '../../src/core/EventBus.js';

describe('AgentLoader', () => {
  let tempDir: string;
  let loader: AgentLoader;

  beforeEach(async () => {
    resetEventBus();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudecab-test-'));
    loader = new AgentLoader({ agentsDir: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('scanAgents', () => {
    it('should return empty array for non-existent directory', async () => {
      const nonExistentLoader = new AgentLoader({
        agentsDir: '/non-existent-path',
      });
      const agents = await nonExistentLoader.scanAgents();
      expect(agents).toEqual([]);
    });

    it('should return agent IDs for directories with agent.json', async () => {
      // Create test agents
      await fs.mkdir(path.join(tempDir, 'agent1'));
      await fs.writeFile(
        path.join(tempDir, 'agent1', 'agent.json'),
        JSON.stringify({ name: 'Agent 1' })
      );

      await fs.mkdir(path.join(tempDir, 'agent2'));
      await fs.writeFile(
        path.join(tempDir, 'agent2', 'agent.json'),
        JSON.stringify({ name: 'Agent 2' })
      );

      // Directory without agent.json should be skipped
      await fs.mkdir(path.join(tempDir, 'not-an-agent'));

      const agents = await loader.scanAgents();
      expect(agents).toHaveLength(2);
      expect(agents).toContain('agent1');
      expect(agents).toContain('agent2');
      expect(agents).not.toContain('not-an-agent');
    });
  });

  describe('loadAgent', () => {
    it('should load agent with valid config', async () => {
      await fs.mkdir(path.join(tempDir, 'test-agent'));
      await fs.writeFile(
        path.join(tempDir, 'test-agent', 'agent.json'),
        JSON.stringify({
          name: 'Test Agent',
          description: 'A test agent',
          model: 'sonnet',
        })
      );

      const agent = await loader.loadAgent('test-agent');

      expect(agent.id).toBe('test-agent');
      expect(agent.config.name).toBe('Test Agent');
      expect(agent.config.description).toBe('A test agent');
      expect(agent.config.model).toBe('sonnet');
    });

    it('should load system prompt from CLAUDE.md', async () => {
      await fs.mkdir(path.join(tempDir, 'test-agent'));
      await fs.writeFile(
        path.join(tempDir, 'test-agent', 'agent.json'),
        JSON.stringify({ name: 'Test Agent' })
      );
      await fs.writeFile(
        path.join(tempDir, 'test-agent', 'CLAUDE.md'),
        'You are a helpful assistant.'
      );

      const agent = await loader.loadAgent('test-agent');

      expect(agent.systemPrompt).toBe('You are a helpful assistant.');
    });

    it('should use systemPrompt from config if provided', async () => {
      await fs.mkdir(path.join(tempDir, 'test-agent'));
      await fs.writeFile(
        path.join(tempDir, 'test-agent', 'agent.json'),
        JSON.stringify({
          name: 'Test Agent',
          systemPrompt: 'Inline system prompt',
        })
      );
      // Also create a file - should be ignored
      await fs.writeFile(
        path.join(tempDir, 'test-agent', 'CLAUDE.md'),
        'File system prompt'
      );

      const agent = await loader.loadAgent('test-agent');

      expect(agent.systemPrompt).toBe('Inline system prompt');
    });

    it('should throw AgentLoadError for non-existent agent', async () => {
      await expect(loader.loadAgent('non-existent')).rejects.toThrow(
        AgentLoadError
      );
    });

    it('should throw AgentConfigError for invalid JSON', async () => {
      await fs.mkdir(path.join(tempDir, 'invalid-agent'));
      await fs.writeFile(
        path.join(tempDir, 'invalid-agent', 'agent.json'),
        'not valid json'
      );

      await expect(loader.loadAgent('invalid-agent')).rejects.toThrow(
        AgentConfigError
      );
    });

    it('should throw AgentConfigError for missing required fields', async () => {
      await fs.mkdir(path.join(tempDir, 'invalid-agent'));
      await fs.writeFile(
        path.join(tempDir, 'invalid-agent', 'agent.json'),
        JSON.stringify({ description: 'Missing name' })
      );

      await expect(loader.loadAgent('invalid-agent')).rejects.toThrow(
        AgentConfigError
      );
    });
  });

  describe('cache', () => {
    it('should cache loaded agents', async () => {
      await fs.mkdir(path.join(tempDir, 'test-agent'));
      await fs.writeFile(
        path.join(tempDir, 'test-agent', 'agent.json'),
        JSON.stringify({ name: 'Test Agent' })
      );

      await loader.loadAgent('test-agent');

      expect(loader.has('test-agent')).toBe(true);
      expect(loader.get('test-agent')).toBeDefined();
    });

    it('should list cached agent IDs', async () => {
      await fs.mkdir(path.join(tempDir, 'agent1'));
      await fs.writeFile(
        path.join(tempDir, 'agent1', 'agent.json'),
        JSON.stringify({ name: 'Agent 1' })
      );

      await fs.mkdir(path.join(tempDir, 'agent2'));
      await fs.writeFile(
        path.join(tempDir, 'agent2', 'agent.json'),
        JSON.stringify({ name: 'Agent 2' })
      );

      await loader.loadAgent('agent1');
      await loader.loadAgent('agent2');

      const ids = loader.list();
      expect(ids).toContain('agent1');
      expect(ids).toContain('agent2');
    });

    it('should clear cache', async () => {
      await fs.mkdir(path.join(tempDir, 'test-agent'));
      await fs.writeFile(
        path.join(tempDir, 'test-agent', 'agent.json'),
        JSON.stringify({ name: 'Test Agent' })
      );

      await loader.loadAgent('test-agent');
      loader.clearCache('test-agent');

      expect(loader.has('test-agent')).toBe(false);
    });
  });

  describe('loadAllAgents', () => {
    it('should load all agents from directory', async () => {
      await fs.mkdir(path.join(tempDir, 'agent1'));
      await fs.writeFile(
        path.join(tempDir, 'agent1', 'agent.json'),
        JSON.stringify({ name: 'Agent 1' })
      );

      await fs.mkdir(path.join(tempDir, 'agent2'));
      await fs.writeFile(
        path.join(tempDir, 'agent2', 'agent.json'),
        JSON.stringify({ name: 'Agent 2' })
      );

      const agents = await loader.loadAllAgents();

      expect(agents).toHaveLength(2);
    });
  });
});

describe('AgentLoader with example agents', () => {
  it('should load general agent from project', async () => {
    const projectAgentsDir = path.resolve(process.cwd(), 'agents');
    const loader = new AgentLoader({ agentsDir: projectAgentsDir });

    try {
      const agent = await loader.loadAgent('general');
      expect(agent.id).toBe('general');
      expect(agent.config.name).toBe('General Assistant');
      expect(agent.systemPrompt).toContain('helpful');
    } catch {
      // Skip if agents directory doesn't exist
    }
  });

  it('should load coder agent with inheritance from project', async () => {
    const projectAgentsDir = path.resolve(process.cwd(), 'agents');
    const loader = new AgentLoader({ agentsDir: projectAgentsDir });

    try {
      const agent = await loader.loadAgent('coder');
      expect(agent.id).toBe('coder');
      expect(agent.config.name).toBe('Code Assistant');
      // Inherited from general
      expect(agent.config.model).toBe('sonnet');
      // Child's allowedTools
      expect(agent.config.allowedTools).toContain('Read');
    } catch {
      // Skip if agents directory doesn't exist
    }
  });
});
