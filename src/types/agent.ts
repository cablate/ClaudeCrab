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
  'dontAsk',
]);

export type PermissionMode = z.infer<typeof PermissionModeSchema>;

/**
 * Model options available for agents
 */
export const ModelSchema = z.enum(['sonnet', 'opus', 'haiku']);

export type Model = z.infer<typeof ModelSchema>;


const AgentSettingsSchema = z.object({
  maxHistoryLength: z.number().int().positive().optional(),
  permissionMode: PermissionModeSchema.optional(),
  maxTurns: z.number().int().positive().optional(),
  maxBudgetUsd: z.number().positive().optional(),
  /** Extended thinking config (passed through to SDK V2 session). */
  thinking: z.object({ type: z.string() }).optional(),
});

/**
 * agent.json Schema
 * Defines the configuration structure for an agent
 */
/** Display configuration for live page visuals */
const DisplaySchema = z.object({
  avatar: z.string().optional(),
  color: z.string().optional(),
  sprite: z.string().optional(),
  portrait: z.string().optional(),
  emoji: z.record(z.string(), z.string()).optional(),
});

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
  discordBotToken: z.string().optional(),
  discordChannelId: z.string().optional(),

  // Discord organization settings
  discord: z.object({
    /** Discord role names for this agent */
    roles: z.array(z.string()).optional(),
    /** Category this agent belongs to (e.g., ENGINEERING) */
    category: z.string().optional(),
    /** Superior agent ID for call directionality */
    reportsTo: z.string().optional(),
  }).optional(),

  // Display configuration (live page visuals)
  display: DisplaySchema.optional(),

  // Additional settings
  settings: AgentSettingsSchema.optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

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
