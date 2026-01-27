import type { LoadedAgent, AgentConfig, Model } from '../types/agent.js';
import { logger } from '../utils/logger.js';

/**
 * SDK Model mapping
 * Maps our model names to SDK model identifiers
 */
const MODEL_MAP: Record<Model, string> = {
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514',
  haiku: 'claude-haiku-3-5-20241022',
};

/**
 * SDK Permission mode mapping
 */
const PERMISSION_MODE_MAP = {
  default: 'default',
  acceptEdits: 'acceptEdits',
  bypassPermissions: 'bypassPermissions',
} as const;

/**
 * Options for the Claude Agent SDK
 * Based on SDK's query() options
 */
export interface SDKOptions {
  /** System prompt for the agent */
  systemPrompt?: string;

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
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';

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
  /**
   * Convert a LoadedAgent to SDK options
   */
  static toSDKOptions(agent: LoadedAgent): SDKOptions {
    const { config, systemPrompt, mcpServers } = agent;

    const options: SDKOptions = {};

    // System prompt
    if (systemPrompt.length > 0) {
      options.systemPrompt = systemPrompt;
    }

    // Model
    if (config.model !== undefined) {
      options.model = MODEL_MAP[config.model];
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
  static getSDKModel(model: Model): string {
    return MODEL_MAP[model];
  }

  /**
   * Merge two agent configs (used for inheritance)
   * Child properties override parent properties
   */
  static mergeConfigs(parent: AgentConfig, child: AgentConfig): AgentConfig {
    return {
      name: child.name,
      description: child.description ?? parent.description,
      version: child.version ?? parent.version,
      model: child.model ?? parent.model,
      maxTokens: child.maxTokens ?? parent.maxTokens,
      maxThinkingTokens: child.maxThinkingTokens ?? parent.maxThinkingTokens,
      systemPrompt: child.systemPrompt ?? parent.systemPrompt,
      systemPromptFile: child.systemPromptFile ?? parent.systemPromptFile,
      allowedTools: ConfigTransformer.mergeArrays(
        parent.allowedTools,
        child.allowedTools
      ),
      disallowedTools: ConfigTransformer.mergeArrays(
        parent.disallowedTools,
        child.disallowedTools
      ),
      mcpConfigFile: child.mcpConfigFile ?? parent.mcpConfigFile,
      settings:
        child.settings !== undefined || parent.settings !== undefined
          ? {
              ...parent.settings,
              ...child.settings,
            }
          : undefined,
    };
  }

  /**
   * Merge two optional arrays, removing duplicates
   */
  private static mergeArrays(
    parent: string[] | undefined,
    child: string[] | undefined
  ): string[] | undefined {
    if (parent === undefined && child === undefined) {
      return undefined;
    }
    const combined = [...(parent ?? []), ...(child ?? [])];
    return Array.from(new Set(combined));
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
