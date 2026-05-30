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
 * SDK Permission mode mapping
 */
const PERMISSION_MODE_MAP = {
  default: 'default',
  acceptEdits: 'acceptEdits',
  bypassPermissions: 'bypassPermissions',
  plan: 'plan',
  dontAsk: 'dontAsk',
} as const;

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
    const { config, systemPrompt, mcpServers } = agent;

    const options: SDKOptions = {};

    // System prompt — append to Claude Code's built-in prompt instead of overriding
    if (systemPrompt.length > 0) {
      options.systemPrompt = {
        type: 'preset' as const,
        preset: 'claude_code' as const,
        append: systemPrompt,
      };
    }

    // Model
    if (config.model !== undefined) {
      options.model = ConfigTransformer.resolveModel(config.model);
    }

    // Token limits
    if (config.maxTokens !== undefined) {
      options.maxTokens = config.maxTokens;
    }

    if (config.maxThinkingTokens !== undefined) {
      options.maxThinkingTokens = config.maxThinkingTokens;
    }

    // Tools
    if (config.allowedTools !== undefined && config.allowedTools.length > 0) {
      options.allowedTools = config.allowedTools;
    }

    if (
      config.disallowedTools !== undefined &&
      config.disallowedTools.length > 0
    ) {
      options.disallowedTools = config.disallowedTools;
    }

    // Settings
    if (config.settings !== undefined) {
      if (config.settings.permissionMode !== undefined) {
        options.permissionMode =
          PERMISSION_MODE_MAP[config.settings.permissionMode];
      }

      if (config.settings.maxTurns !== undefined) {
        options.maxTurns = config.settings.maxTurns;
      }
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
