import { describe, it, expect } from 'vitest';
import { ConfigTransformer } from '../../src/core/ConfigTransformer.js';
import type { LoadedAgent, AgentConfig } from '../../src/types/agent.js';

describe('ConfigTransformer', () => {
  describe('toSDKOptions', () => {
    it('should convert minimal agent to SDK options', () => {
      const agent: LoadedAgent = {
        id: 'test',
        path: '/path/to/test',
        config: {
          name: 'Test Agent',
        },
        systemPrompt: '',
      };

      const options = ConfigTransformer.toSDKOptions(agent);

      expect(options.systemPrompt).toBeUndefined();
      expect(options.model).toBeUndefined();
    });

    it('should include system prompt when not empty', () => {
      const agent: LoadedAgent = {
        id: 'test',
        path: '/path/to/test',
        config: {
          name: 'Test Agent',
        },
        systemPrompt: 'You are a helpful assistant.',
      };

      const options = ConfigTransformer.toSDKOptions(agent);

      expect(options.systemPrompt).toBe('You are a helpful assistant.');
    });

    it('should map model names correctly', () => {
      const testCases: Array<{
        model: 'sonnet' | 'opus' | 'haiku';
        expected: string;
      }> = [
        { model: 'sonnet', expected: 'claude-sonnet-4-20250514' },
        { model: 'opus', expected: 'claude-opus-4-20250514' },
        { model: 'haiku', expected: 'claude-haiku-3-5-20241022' },
      ];

      for (const { model, expected } of testCases) {
        const agent: LoadedAgent = {
          id: 'test',
          path: '/path/to/test',
          config: { name: 'Test', model },
          systemPrompt: '',
        };

        const options = ConfigTransformer.toSDKOptions(agent);
        expect(options.model).toBe(expected);
      }
    });

    it('should include token limits', () => {
      const agent: LoadedAgent = {
        id: 'test',
        path: '/path/to/test',
        config: {
          name: 'Test Agent',
          maxTokens: 4096,
          maxThinkingTokens: 2048,
        },
        systemPrompt: '',
      };

      const options = ConfigTransformer.toSDKOptions(agent);

      expect(options.maxTokens).toBe(4096);
      expect(options.maxThinkingTokens).toBe(2048);
    });

    it('should include tools configuration', () => {
      const agent: LoadedAgent = {
        id: 'test',
        path: '/path/to/test',
        config: {
          name: 'Test Agent',
          allowedTools: ['Read', 'Write'],
          disallowedTools: ['Bash'],
        },
        systemPrompt: '',
      };

      const options = ConfigTransformer.toSDKOptions(agent);

      expect(options.allowedTools).toEqual(['Read', 'Write']);
      expect(options.disallowedTools).toEqual(['Bash']);
    });

    it('should include settings', () => {
      const agent: LoadedAgent = {
        id: 'test',
        path: '/path/to/test',
        config: {
          name: 'Test Agent',
          settings: {
            permissionMode: 'acceptEdits',
            maxTurns: 15,
          },
        },
        systemPrompt: '',
      };

      const options = ConfigTransformer.toSDKOptions(agent);

      expect(options.permissionMode).toBe('acceptEdits');
      expect(options.maxTurns).toBe(15);
    });

    it('should include MCP servers', () => {
      const agent: LoadedAgent = {
        id: 'test',
        path: '/path/to/test',
        config: { name: 'Test Agent' },
        systemPrompt: '',
        mcpServers: {
          myServer: {
            command: 'node',
            args: ['server.js'],
          },
        },
      };

      const options = ConfigTransformer.toSDKOptions(agent);

      expect(options.mcpServers).toBeDefined();
      expect(options.mcpServers!['myServer']).toEqual({
        command: 'node',
        args: ['server.js'],
      });
    });
  });

  describe('getSDKModel', () => {
    it('should return correct SDK model string', () => {
      expect(ConfigTransformer.getSDKModel('sonnet')).toBe(
        'claude-sonnet-4-20250514'
      );
      expect(ConfigTransformer.getSDKModel('opus')).toBe(
        'claude-opus-4-20250514'
      );
      expect(ConfigTransformer.getSDKModel('haiku')).toBe(
        'claude-haiku-3-5-20241022'
      );
    });
  });

  describe('mergeConfigs', () => {
    it('should merge parent and child configs', () => {
      const parent: AgentConfig = {
        name: 'Parent',
        description: 'Parent description',
        model: 'sonnet',
        allowedTools: ['Read'],
        settings: {
          maxTurns: 10,
        },
      };

      const child: AgentConfig = {
        name: 'Child',
        allowedTools: ['Write'],
        settings: {
          maxTurns: 20,
        },
      };

      const merged = ConfigTransformer.mergeConfigs(parent, child);

      expect(merged.name).toBe('Child');
      expect(merged.description).toBe('Parent description');
      expect(merged.model).toBe('sonnet');
      expect(merged.allowedTools).toEqual(['Read', 'Write']);
      expect(merged.settings?.maxTurns).toBe(20);
    });

    it('should deduplicate merged arrays', () => {
      const parent: AgentConfig = {
        name: 'Parent',
        allowedTools: ['Read', 'Write'],
      };

      const child: AgentConfig = {
        name: 'Child',
        allowedTools: ['Write', 'Bash'],
      };

      const merged = ConfigTransformer.mergeConfigs(parent, child);

      expect(merged.allowedTools).toEqual(['Read', 'Write', 'Bash']);
    });
  });

  describe('validateSDKOptions', () => {
    it('should return empty array for valid options', () => {
      const options = {
        maxTokens: 4096,
        maxTurns: 10,
      };

      const errors = ConfigTransformer.validateSDKOptions(options);
      expect(errors).toEqual([]);
    });

    it('should return errors for invalid options', () => {
      const options = {
        maxTokens: -1,
        maxThinkingTokens: 0,
        maxTurns: -5,
      };

      const errors = ConfigTransformer.validateSDKOptions(options);

      expect(errors).toContain('maxTokens must be positive');
      expect(errors).toContain('maxThinkingTokens must be positive');
      expect(errors).toContain('maxTurns must be positive');
    });
  });
});
