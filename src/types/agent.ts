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

/** ADR-022: Delegation settings for multi-agent collaboration */
const DelegationSettingsSchema = z.object({
  /** Allow inbound delegation — other bots can trigger me via @mention (default: true) */
  inbound: z.boolean().optional(),
  /** Allow outbound delegation — my replies with @mention can trigger other bots (default: true) */
  outbound: z.boolean().optional(),
});;

/** ADR-023: Initiative settings for bot proactive responses */
const InitiativeSettingsSchema = z.object({
  /** Enable bot initiative — bot can proactively respond to non-@mentioned messages (default: false) */
  enabled: z.boolean().optional(),
  /** Initiative mode: determines evaluation prompt and throttle behavior */
  mode: z.enum(['work', 'social', 'full']).optional(),
  /** Cooldown in seconds between initiative responses per group (default: 300) */
  cooldown: z.number().int().positive().optional(),
  /** Max initiative responses per hour per group (default: 5) */
  maxPerHour: z.number().int().positive().optional(),
});

/** Social mode settings — bot can chat naturally in groups without @mention */
const SocialSettingsSchema = z.object({
  /** Enable social mode (default: false) */
  enabled: z.boolean().optional(),
  /** Minimum energy score (1-5) to trigger a social response (default: 3) */
  energyThreshold: z.number().int().min(1).max(5).optional(),
  /** Cooldown in seconds between social responses per group (default: 600) */
  cooldown: z.number().int().positive().optional(),
  /** Max social responses per hour per group (default: 10) */
  maxPerHour: z.number().int().positive().optional(),
  /** Max consecutive bot-only turns before forced silence (default: 3) */
  maxConsecutiveBotTurns: z.number().int().positive().optional(),
});

export type SocialSettings = z.infer<typeof SocialSettingsSchema>;

export type InitiativeSettings = z.infer<typeof InitiativeSettingsSchema>;

export const AgentSettingsSchema = z.object({
  maxHistoryLength: z.number().int().positive().optional(),
  permissionMode: PermissionModeSchema.optional(),
  maxTurns: z.number().int().positive().optional(),
  maxBudgetUsd: z.number().positive().optional(),
  /** ADR-022: Delegation settings */
  delegation: DelegationSettingsSchema.optional(),
  /** ADR-023: Initiative settings */
  initiative: InitiativeSettingsSchema.optional(),
  /** Social mode settings */
  social: SocialSettingsSchema.optional(),
});;

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
