import { z } from 'zod/v4';
import type { AgentHooks } from './hooks.js';

/**
 * Runtime model aliases used across ClaudeCab (settings.local.json `model`
 * field and SDK option resolution). NOT agent.json fields — agent.json only
 * carries ClaudeCab metadata and platform wiring.
 */
export const ModelSchema = z.enum(['sonnet', 'opus', 'haiku']);

export type Model = z.infer<typeof ModelSchema>;


/**
 * agent.json Schema
 * Defines ClaudeCab-facing agent metadata and platform wiring.
 * Claude Code / SDK runtime settings belong in .claude/settings.local.json.
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
