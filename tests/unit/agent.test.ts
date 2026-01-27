import { describe, it, expect } from 'vitest';
import {
  AgentConfigSchema,
  validateAgentConfig,
  safeValidateAgentConfig,
} from '../../src/types/agent.js';

describe('AgentConfigSchema', () => {
  describe('valid configurations', () => {
    it('should accept minimal valid config', () => {
      const config = {
        name: 'Test Agent',
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Test Agent');
      }
    });

    it('should accept full valid config', () => {
      const config = {
        name: 'Full Agent',
        description: 'A complete agent configuration',
        version: '1.0.0',
        extends: 'base',
        model: 'sonnet',
        maxTokens: 4096,
        maxThinkingTokens: 2048,
        systemPrompt: 'You are a helpful assistant.',
        allowedTools: ['Read', 'Write'],
        disallowedTools: ['Bash'],
        mcpConfigFile: 'mcp.json',
        settings: {
          maxHistoryLength: 50,
          permissionMode: 'default',
          maxTurns: 10,
          maxBudgetUsd: 1.5,
        },
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Full Agent');
        expect(result.data.model).toBe('sonnet');
        expect(result.data.settings?.maxBudgetUsd).toBe(1.5);
      }
    });

    it('should accept all valid model types', () => {
      const models = ['sonnet', 'opus', 'haiku'] as const;

      for (const model of models) {
        const config = { name: 'Test', model };
        const result = AgentConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }
    });

    it('should accept all valid permission modes', () => {
      const modes = ['default', 'acceptEdits', 'bypassPermissions'] as const;

      for (const permissionMode of modes) {
        const config = {
          name: 'Test',
          settings: { permissionMode },
        };
        const result = AgentConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('invalid configurations', () => {
    it('should reject config without name', () => {
      const config = {
        description: 'Missing name',
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty name', () => {
      const config = {
        name: '',
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject invalid model', () => {
      const config = {
        name: 'Test',
        model: 'invalid-model',
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject negative maxTokens', () => {
      const config = {
        name: 'Test',
        maxTokens: -100,
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject zero maxBudgetUsd', () => {
      const config = {
        name: 'Test',
        settings: {
          maxBudgetUsd: 0,
        },
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject invalid permission mode', () => {
      const config = {
        name: 'Test',
        settings: {
          permissionMode: 'invalid',
        },
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject non-integer maxTurns', () => {
      const config = {
        name: 'Test',
        settings: {
          maxTurns: 5.5,
        },
      };

      const result = AgentConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });
});

describe('validateAgentConfig', () => {
  it('should return parsed config for valid input', () => {
    const config = { name: 'Valid Agent' };
    const result = validateAgentConfig(config);
    expect(result.name).toBe('Valid Agent');
  });

  it('should throw for invalid input', () => {
    const config = { description: 'No name' };
    expect(() => validateAgentConfig(config)).toThrow();
  });
});

describe('safeValidateAgentConfig', () => {
  it('should return success for valid input', () => {
    const config = { name: 'Valid Agent' };
    const result = safeValidateAgentConfig(config);
    expect(result.success).toBe(true);
  });

  it('should return error for invalid input', () => {
    const config = { description: 'No name' };
    const result = safeValidateAgentConfig(config);
    expect(result.success).toBe(false);
  });
});
