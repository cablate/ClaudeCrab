/**
 * SDKSessionTypes ??shared type definitions for V2 session management modules.
 *
 * These types are used across:
 *   - SDKSessionFactory (creates ManagedSession)
 *   - SDKStreamProcessor (reads/writes ManagedSession fields)
 *   - SDKKeepaliveManager (reads/writes keepalive fields)
 *   - SDKSessionManager (owns the sessions Map)
 */

import type { SDKSession, McpSdkServerConfigWithInstance, AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { ExecuteQueryOptions, QueryModelUsage } from '../query/SDKQueryManager.js';
import type { GovernanceSessionState } from '../governance/telemetry.js';
import type { ConversationRuntimeContext } from '../../types/runtimeContext.js';
import type { SubAgentMessageManager } from '../query/SubAgentMessageManager.js';

/**
 * Extended V2 session options (matches patched sdk.mjs).
 * The patch adds settingSources / systemPrompt / mcpServers / etc.
 */
export interface PatchedSessionOptions {
  model: string;
  cwd?: string;
  permissionMode?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  env?: Record<string, string | undefined>;
  settingSources?: Array<'user' | 'project' | 'local'>;
  mcpServers?: Record<string, McpSdkServerConfigWithInstance>;
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };
  thinking?: { type: string };
  maxTurns?: number;
  extraArgs?: Record<string, unknown>;
  additionalDirectories?: string[];
  /** Programmatic subagent definitions forwarded to SDK initialize payload. */
  agents?: Record<string, AgentDefinition>;
  /** Optional main-session skill allowlist. Subagents use AgentDefinition.skills. */
  skills?: string[];
  /** SDK option for forwarding raw subagent text into the parent stream. */
  forwardSubagentText?: boolean;
  /**
   * Override path to the Claude Code CLI executable.
   */
  pathToClaudeCodeExecutable?: string;
}

/**
 * Extended session options that include runtime-only fields not in the TypeScript types
 * (canUseTool callback, hooks, includeHookEvents, agentProgressSummaries).
 */
export interface ExtendedSessionOptions extends PatchedSessionOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  canUseTool?: (...args: any[]) => Promise<unknown>;
  hooks?: Record<string, unknown>;
  includeHookEvents?: boolean;
  agentProgressSummaries?: boolean;
}

/** Cumulative usage snapshot ??used to compute per-query deltas for V2 sessions */
export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
  totalCostUsd: number;
}

export interface ManagedSession {
  session: SDKSession;
  sdkSessionId: string;
  agentId: string;
  /** Resolved main-session model ID (e.g. "claude-opus-4-6-20250506"). */
  model: string;
  cwd: string;
  runtimeContext?: ConversationRuntimeContext;
  createdAt: number;
  lastUsedAt: number;
  messageCount: number;
  /** Previous cumulative usage ??subtract from current to get per-query delta */
  prevUsage: UsageSnapshot;
  /** Previous cumulative per-model usage, used to identify models used in the current query. */
  prevModelUsage?: Record<string, QueryModelUsage>;
  /** True while executeQuery is running (send + processStream in progress) */
  isQuerying: boolean;
  /** Passive workspace governance telemetry for the current user query. */
  governance: GovernanceSessionState;
  /**
   * Per-query callbacks/options for persistent V2 hook closures.
   * Hooks are registered once when the SDK session is created, so they must read
   * the current turn's callbacks from here instead of closing over stale options.
   */
  currentOptions?: ExecuteQueryOptions;
  /** Sub-agent Discord UI manager (Plan G). Set once when the first query creates a session. */
  subAgentManager?: SubAgentMessageManager;
  /** Set to true when /stop is called ??processStream checks this to break the loop */
  cancelled?: boolean;
  /** Timestamp when interrupt() was called ??used to distinguish graceful vs hard cancel */
  interruptedAt?: number | undefined;
  /** Cache keepalive timer ??pings session to prevent Anthropic API cache TTL expiry */
  keepaliveTimer?: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | undefined;
  /**
   * Effective keepalive interval for this session. This can differ from the env
   * default after the API reports the actual prompt-cache TTL tier.
   */
  currentKeepaliveIntervalMs?: number;
  /**
   * Best-effort timestamp for when the Anthropic prompt cache was last touched.
   * Updated when stream usage reports cache read/write tokens, not just when the
   * user query completes. This matters for long-running turns on 5-minute TTL.
   */
  lastCacheTouchAt?: number;
  /** Rolling cache efficiency (0-100) for monitoring */
  cacheEfficiencyAvg?: number | undefined;
  /**
   * True while a cache keepalive ping is running. Hook callbacks short-circuit when
   * this is set: no UI emit and no prompt-checklist injection.
   */
  isKeepalivePing?: boolean;
  /**
   * Promise returned by the most recent `options.onIntermediateMessage` call.
   * Hook/UI emissions can await this before posting their subtitle.
   */
  lastIntermediateSendPromise?: Promise<void> | undefined;
  /**
   * Pre-drain orphan carry-over. When preDrainResidualMessages times out with a
   * pending promise, it is preserved here so processStream can consume it first.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pendingDrainPromise?: Promise<IteratorResult<any>> | undefined;
  /**
   * Timestamp (ms) of the last real user query completion.
   * Updated by SDKStreamProcessor on normal query completion.
   * NOT updated by keepalive pings (isKeepalivePing=true).
   * Used by session-length-handoff-guard to detect cache TTL expiry.
   */
  lastQueryAt: number;
  /**
   * Session length guard: set to true once the "session too long" warning has
   * been shown. Re-triggers when tokenCount > guardLastShownTokenCount * 1.5.
   */
  guardShownForLength?: boolean;
  /**
   * The cumulative token count at which the length guard was last shown.
   * Used to determine if re-triggering is appropriate.
   */
  guardLastShownTokenCount?: number;
  /**
   * Session cache-TTL guard: set to true once the "cache expired" warning has
   * been shown. Resets to false after each query (lastQueryAt update) so it
   * can fire again on the next idle gap.
   */
  guardShownForCacheTTL?: boolean;
  /**
   * Approximate current context window size in tokens (last turn's input total).
   * = last turn's (inputTokens + cacheReadInputTokens + cacheCreationInputTokens).
   * Updated by SDKStreamProcessor after each query result.
   */
  lastTurnContextTokens?: number;
  /**
   * Model's maximum context window size in tokens (from modelUsage.contextWindow).
   * Used to calculate usage percentage for session guard.
   */
  contextWindowSize?: number;
  /**
   * Detected cache TTL in ms from API response (ephemeral_1h = 3600000, ephemeral_5m = 300000).
   * Set once per session from the first assistant message with cache_creation data.
   */
  detectedCacheTTLMs?: number;
  /**
   * Best-effort marker that the SDK transcript changed after the last cache
   * touch. The next keepalive may need to write cache even when TTL is healthy.
   */
  needsCacheWarmup?: boolean;
  healingRetryCount?: number;
  lastPromptCacheMutation?: {
    reason: 'stop_hook_summary';
    at: number;
    detail: string;
  };
  lastKeepaliveAnomaly?: {
    at: number;
    hitPct: number | null;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    freshInputTokens: number;
    likelyCause?: string;
    discordUrl?: string;
    sourceMessageUrl?: string;
    transcriptPath?: string;
    details: string;
  };
}
