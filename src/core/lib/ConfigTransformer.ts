import type { LoadedAgent, Model } from '../../types/agent.js';
import { logger } from '../../utils/logger.js';

/**
 * SDK Model mapping
 * Maps our model names to SDK model identifiers
 */
const MODEL_MAP: Record<Model, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

/**
 * Options for the Claude Agent SDK
 * Based on SDK's query() options
 */
export interface SDKOptions {
  /** System prompt — preset append preserves Claude Code's built-in prompt */
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append: string };

  /** Model to use */
  model?: string;

  /** Maximum tokens for response */
  maxTokens?: number;

  /** Maximum thinking tokens */
  maxThinkingTokens?: number;

  /** Allowed tools */
  allowedTools?: string[];

  /** Disallowed tools */
  disallowedTools?: string[];

  /** Permission mode */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk';

  /** Maximum turns for the conversation */
  maxTurns?: number;

  /** MCP servers configuration */
  mcpServers?: Record<
    string,
    {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      transport?: 'stdio' | 'sse' | 'http';
    }
  >;
}

/**
 * Transforms agent configurations to SDK-compatible options
 */
export class ConfigTransformer {
  static readonly MODEL_MAP = MODEL_MAP;

  static resolveModel(alias: Model | string): string {
    const model = MODEL_MAP[alias as Model];
    if (model !== undefined) return model;
    return alias;
  }

  /**
   * Convert a LoadedAgent to SDK options
   */
  static toSDKOptions(agent: LoadedAgent): SDKOptions {
    const { systemPrompt, mcpServers } = agent;

    const options: SDKOptions = {};

    // System prompt — append to Claude Code's built-in prompt instead of overriding
    if (systemPrompt.length > 0) {
      options.systemPrompt = {
        type: 'preset' as const,
        preset: 'claude_code' as const,
        append: systemPrompt,
      };
    }

    // MCP servers
    if (mcpServers !== undefined && Object.keys(mcpServers).length > 0) {
      options.mcpServers = mcpServers;
    }

    logger.debug(
      {
        agentId: agent.id,
        hasSystemPrompt: options.systemPrompt !== undefined,
        model: options.model,
        mcpServerCount: Object.keys(options.mcpServers ?? {}).length,
      },
      'Transformed agent config to SDK options'
    );

    return options;
  }

  /**
   * Get the SDK model string for a model name
   */
  static getSDKModel(model: Model | string): string {
    return ConfigTransformer.resolveModel(model);
  }

  /**
   * Validate SDK options before use
   */
  static validateSDKOptions(options: SDKOptions): string[] {
    const errors: string[] = [];

    if (options.maxTokens !== undefined && options.maxTokens <= 0) {
      errors.push('maxTokens must be positive');
    }

    if (options.maxThinkingTokens !== undefined && options.maxThinkingTokens <= 0) {
      errors.push('maxThinkingTokens must be positive');
    }

    if (options.maxTurns !== undefined && options.maxTurns <= 0) {
      errors.push('maxTurns must be positive');
    }

    return errors;
  }
}
