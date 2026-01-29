import { z } from 'zod/v4';
import type { AgentHooks } from './hooks.js';

/**
 * Permission mode for agent operations
 */
export const PermissionModeSchema = z.enum([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'delegate',
  'dontAsk',
]);

export type PermissionMode = z.infer<typeof PermissionModeSchema>;

/**
 * Model options available for agents
 */
export const ModelSchema = z.enum(['sonnet', 'opus', 'haiku']);

export type Model = z.infer<typeof ModelSchema>;

/**
 * Agent settings configuration
 */
export const AgentSettingsSchema = z.object({
  maxHistoryLength: z.number().int().positive().optional(),
  permissionMode: PermissionModeSchema.optional(),
  maxTurns: z.number().int().positive().optional(),
  maxBudgetUsd: z.number().positive().optional(),
});

export type AgentSettings = z.infer<typeof AgentSettingsSchema>;

/**
 * agent.json Schema
 * Defines the configuration structure for an agent
 */
export const AgentConfigSchema = z.object({
  // Basic information
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().optional(),

  // Model configuration
  model: ModelSchema.optional(),
  maxTokens: z.number().int().positive().optional(),
  maxThinkingTokens: z.number().int().positive().optional(),

  // Prompt configuration
  systemPrompt: z.string().optional(),
  systemPromptFile: z.string().optional(),

  // Tool configuration
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),

  // MCP configuration
  mcpConfigFile: z.string().optional(),

  // Platform bot tokens
  telegramBotToken: z.string().optional(),

  // Additional settings
  settings: AgentSettingsSchema.optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/**
 * Validate agent configuration
 * @throws ZodError if validation fails
 */
export function validateAgentConfig(data: unknown): AgentConfig {
  return AgentConfigSchema.parse(data);
}

/**
 * Safe parse result type
 */
export type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: z.ZodError };

/**
 * Safely validate agent configuration
 * @returns Result with data or error
 */
export function safeValidateAgentConfig(data: unknown): SafeParseResult<AgentConfig> {
  return AgentConfigSchema.safeParse(data) as SafeParseResult<AgentConfig>;
}

/**
 * MCP Server configuration
 * Matches SDK's McpServerConfig structure
 */
export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: 'stdio' | 'sse' | 'http';
}

/**
 * Loaded agent instance
 * Represents a fully loaded and validated agent ready for use
 */
export interface LoadedAgent {
  /** Directory name (agent identifier) */
  id: string;

  /** Full path to agent directory */
  path: string;

  /** Parsed and validated configuration */
  config: AgentConfig;

  /** Resolved system prompt content */
  systemPrompt: string;

  /** Loaded hooks (optional) */
  hooks?: AgentHooks;

  /** MCP server configurations (optional) */
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * Interface for agent repository
 * Used for dependency injection
 */
export interface IAgentRepository {
  get(agentId: string): LoadedAgent | undefined;
  list(): string[];
}
