/**
 * SDKSessionManager — Persistent Session wrapper for SDK V2 API
 *
 * Solves the token consumption problem: SDK V1 query() spawns a new CLI process
 * per call, causing prompt cache bust (~25% efficiency). V2 createSession keeps
 * the process alive, so prompt cache naturally persists across messages (~95%+ efficiency).
 *
 * Requires: patched sdk.mjs (scripts/patch-sdk-v2.cjs) to support
 * settingSources, systemPrompt, mcpServers in V2 SDKSessionOptions.
 *
 * See: _special-research/sdk-reverse-engineering-v76.md
 */

import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type SDKSession,
  type SDKMessage,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk';
import type { LoadedAgent } from '../types/agent.js';
import type { ToolEvent } from '../adapters/types.js';
import type { QueryUsage, QueryResult, ExecuteQueryOptions } from './SDKQueryManager.js';
import { logger } from '../utils/logger.js';

/**
 * Extended V2 session options (matches patched sdk.mjs)
 * The patch adds these fields to SDKSessionOptions which are missing in stock SDK.
 */
interface PatchedSessionOptions {
  model: string;
  cwd?: string;
  permissionMode?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  env?: Record<string, string | undefined>;
  // Patched fields:
  settingSources?: Array<'user' | 'project' | 'local'>;
  mcpServers?: Record<string, McpSdkServerConfigWithInstance>;
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };
  thinking?: { type: string };
  maxTurns?: number;
  maxBudgetUsd?: number;
  extraArgs?: Record<string, unknown>;
}

/**
 * Extended session options that include runtime-only fields not in the TypeScript types
 * (canUseTool callback, hooks). These are passed directly to the SDK at runtime.
 */
interface ExtendedSessionOptions extends PatchedSessionOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  canUseTool?: (...args: any[]) => Promise<unknown>;
  hooks?: Record<string, unknown>;
}

/** Cumulative usage snapshot — used to compute per-query deltas for V2 sessions */
interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
  totalCostUsd: number;
}

interface ManagedSession {
  session: SDKSession;
  sdkSessionId: string;
  createdAt: number;
  lastUsedAt: number;
  messageCount: number;
  /** Previous cumulative usage — subtract from current to get per-query delta */
  prevUsage: UsageSnapshot;
  /** True while executeQuery is running (send + processStream in progress) */
  isQuerying: boolean;
  /** Set to true when /stop is called — processStream checks this to break the loop */
  cancelled?: boolean;
}

/**
 * Manages persistent SDK V2 sessions for agent conversations.
 *
 * Key difference from SDKQueryManager:
 * - V1 (old): each executeQuery() spawns new CLI process → cache bust
 * - V2 (this): process stays alive between messages → cache persists
 */
export class SDKSessionManager {
  private sessions = new Map<string, ManagedSession>();
  private disposed = false;

  /**
   * Send a message within a persistent session.
   * Creates a new session on first call, reuses on subsequent calls.
   */
  async executeQuery(
    sessionId: string,
    prompt: string,
    agent: LoadedAgent,
    options: ExecuteQueryOptions
  ): Promise<QueryResult> {
    if (this.disposed) {
      throw new Error('SDKSessionManager has been disposed');
    }

    const startTime = Date.now();

    // Get or create persistent session
    let managed = this.sessions.get(sessionId);
    if (!managed) {
      managed = await this.createSession(sessionId, agent, options);
    }

    // Send the message
    logger.info(
      {
        sessionId,
        agentId: agent.id,
        promptLength: prompt.length,
        sdkSessionId: managed.sdkSessionId,
        messageCount: managed.messageCount,
        sessionAgeMs: Date.now() - managed.createdAt,
      },
      'Sending message via persistent V2 session'
    );

    managed.isQuerying = true;
    managed.cancelled = false;
    try {
      await managed.session.send(prompt);
      managed.lastUsedAt = Date.now();
      managed.messageCount++;

      // Process stream
      const result = await this.processStream(sessionId, managed, options, startTime);

      // If resumed session returned 0 content AND no intermediate messages were sent,
      // the resume likely failed silently. Destroy and retry with a fresh session.
      // NOTE: When onIntermediateMessage is used (Discord/Telegram), text goes through
      // the callback — response is always empty. Only treat as failure if BOTH are zero.
      const intermediateCount = result.intermediateMessageCount ?? 0;
      const outputTokens = result.usage?.outputTokens ?? 0;
      const hasOutput = result.response.length > 0 || intermediateCount > 0 || outputTokens > 0;
      if (options.resume && managed.messageCount === 1) {
        logger.debug(
          { sessionId, hasOutput, responseLen: result.response.length, intermediateCount, outputTokens },
          'V2 resume output check'
        );
      }
      if (options.resume && !hasOutput && managed.messageCount === 1) {
        logger.warn(
          { sessionId, sdkSessionId: managed.sdkSessionId },
          'V2 resumed session returned empty response — retrying with fresh session'
        );
        this.destroySession(sessionId);

        const freshOptions = { ...options, resume: undefined };
        managed = await this.createSession(sessionId, agent, freshOptions);
        managed.isQuerying = true;

        await managed.session.send(prompt);
        managed.lastUsedAt = Date.now();
        managed.messageCount++;

        const freshResult = await this.processStream(sessionId, managed, freshOptions, Date.now());
        freshResult.resumeLost = true;
        return freshResult;
      }

      return result;
    } catch (error) {
      // Session might have died — clean up and let caller retry with V1 fallback
      // SDK abort may throw non-Error values like { value: "..." }
      const errDetail = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'value' in error
          ? String((error as { value: unknown }).value)
          : String(error);
      logger.warn(
        { sessionId, error: errDetail },
        'V2 session error, cleaning up'
      );
      this.destroySession(sessionId);
      throw error;
    } finally {
      // Clear querying flag — managed may have been replaced (fresh session retry),
      // so also clear on the current sessions map entry if it still exists.
      managed.isQuerying = false;
      const current = this.sessions.get(sessionId);
      if (current && current !== managed) {
        current.isQuerying = false;
      }
    }
  }

  /**
   * Create a new persistent V2 session
   */
  private async createSession(
    sessionId: string,
    agent: LoadedAgent,
    options: ExecuteQueryOptions
  ): Promise<ManagedSession> {
    const sessionOptions: ExtendedSessionOptions = {
      model: agent.config.model ?? 'claude-sonnet-4-20250514',
      cwd: options.cwd, // Agent working directory — critical for JSONL path resolution
      permissionMode: 'default',
      // V2 reads settings.local.json via settingSources for permissions (allow/deny).
      // WARNING: settings.local.json must NOT contain "hooks" — V2 CLI cannot execute
      // command-type hooks and returns 0 turns immediately if hooks are present.
      settingSources: options.settingSources ?? ['project', 'local'],
      env: {
        CLAUDE_CODE_REMOTE: '1', // Skip gitStatus injection
      },
    };

    // System prompt
    if (options.systemPrompt) {
      sessionOptions.systemPrompt = {
        type: 'preset',
        preset: 'claude_code',
        append: options.systemPrompt,
      };
    } else {
      sessionOptions.systemPrompt = {
        type: 'preset',
        preset: 'claude_code',
      };
    }

    // MCP servers: passed via h9's sdkMcpMap (in-process routing), NOT via CLI --mcp-config args.
    // V1 extracts type:"sdk" + instance entries into a Map for h9, and the rest goes to CLI args.
    // Our patch replicates V1's logic in cQ constructor: builds the Map from Q.mcpServers.
    if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
      sessionOptions.mcpServers = options.mcpServers;
      if (options.allowedTools) {
        sessionOptions.allowedTools = options.allowedTools;
      }
    }

    // Max turns
    if (options.maxTurns !== undefined) {
      sessionOptions.maxTurns = options.maxTurns;
    }

    // canUseTool: interactive permission prompt (Telegram/Discord buttons)
    if (options.additionalOptions?.canUseTool !== undefined) {
      sessionOptions.canUseTool = options.additionalOptions.canUseTool;
    }

    // V2 hooks must be JS callbacks (not command-type).
    // settings.local.json hooks cause 0-turn responses in V2.
    // SDK registers callback IDs → CLI sends hook_callback → SDK executes callback.
    // All hooks implemented in pure JS (no shell scripts) for Windows compatibility.
    sessionOptions.hooks = {
      UserPromptSubmit: [{
        matcher: '',
        hooks: [async () => {
          // Inline equivalent of skill-reminder.sh — no bash dependency
          return {
            decision: 'approve' as const,
            reason: '⚠️ 動手前先載入對應 skill（含 references/）。不要合理化跳過。',
          };
        }],
      }],
      PostToolUse: [{
        matcher: 'Bash',
        hooks: [async (input: unknown) => {
          try {
            // Inline equivalent of error-detector.sh — pure JS, no bash dependency
            const toolOutput = (input as { tool_output?: string })?.tool_output ?? '';
            if (!toolOutput) return { continue: true };

            // Error pattern matching (mirrors error-detector.sh)
            const errorPatterns = [
              // Generic errors
              /^error:/im, /^Error:/m, /fatal:/i, /FAILED/i,
              /command not found/, /No such file or directory/,
              /Permission denied/i,
              // Node.js / npm
              /npm ERR!/, /Cannot find module/, /MODULE_NOT_FOUND/, /ERR_MODULE_NOT_FOUND/,
              // Python
              /Traceback \(most recent call last\)/, /SyntaxError:/, /ModuleNotFoundError:/,
              // TypeScript / JavaScript
              /TypeError:/, /ReferenceError:/,
              // System
              /ENOENT/, /EACCES/, /EPERM/, /ENOMEM/,
              // Exit code
              /exit code [1-9]|Exit code: [1-9]|exited with code [1-9]/i,
            ];

            const hasError = errorPatterns.some(p => p.test(toolOutput));
            if (hasError) {
              return {
                continue: true,
                hookSpecificOutput: {
                  additionalContext: '<error-detected>\n偵測到指令錯誤。如果這個錯誤值得記錄（非一次性的、可能再次遇到），\n請記錄到 `.learnings/ERRORS.md`，格式參考該檔案頂部的模板。\n如果這個錯誤已經在 ERRORS.md 中有記錄，更新其 Recurrence 計數。\n</error-detected>',
                },
              };
            }
            return { continue: true };
          } catch (err) {
            logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'PostToolUse hook failed');
            return { continue: true };
          }
        }],
      }],
      Stop: [{
        matcher: '',
        hooks: [async (input: unknown) => {
          const { stop_hook_active } = input as { stop_hook_active?: boolean };
          if (stop_hook_active) return { continue: true }; // Already in stop hook — don't recurse
          return {
            decision: 'block' as const,
            reason: '⚠️ Session 結束前，讀取 ../_shared/hooks/session-end-checklist.md 並靜默執行所有檢查項。',
          };
        }],
      }],
    };

    // Create or resume session
    // Double cast is intentional: ExtendedSessionOptions includes runtime-only fields
    // (canUseTool, hooks) that exist in the SDK at runtime but not in its TypeScript types.
    let session: SDKSession;
    if (options.resume) {
      session = unstable_v2_resumeSession(
        options.resume,
        sessionOptions as unknown as Parameters<typeof unstable_v2_resumeSession>[1]
      );
    } else {
      session = unstable_v2_createSession(
        sessionOptions as unknown as Parameters<typeof unstable_v2_createSession>[0]
      );
    }

    // Wait for init message to get sessionId
    const sdkSessionId = options.resume ?? '';

    const managed: ManagedSession = {
      session,
      sdkSessionId,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      messageCount: 0,
      prevUsage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUsd: 0, totalCostUsd: 0 },
      isQuerying: false,
    };

    this.sessions.set(sessionId, managed);

    logger.info(
      {
        sessionId,
        sdkSessionId,
        hasResume: !!options.resume,
        sessionOpts: {
          model: sessionOptions.model,
          cwd: sessionOptions.cwd,
          settingSources: sessionOptions.settingSources,
          permissionMode: sessionOptions.permissionMode,
          allowedToolsCount: sessionOptions.allowedTools?.length ?? 0,
          hasMcpServers: sessionOptions.mcpServers ? Object.keys(sessionOptions.mcpServers).length : 0,
        },
      },
      'V2 persistent session created'
    );

    return managed;
  }

  /**
   * Process stream messages from a V2 session (same logic as SDKQueryManager)
   */
  private async processStream(
    sessionId: string,
    managed: ManagedSession,
    options: ExecuteQueryOptions,
    startTime: number
  ): Promise<QueryResult> {
    const responseChunks: string[] = [];
    let numTurns = 0;
    let durationMs = 0;
    let intermediateCount = 0;
    let usage: QueryUsage | undefined;
    let totalCostUsd: number | undefined;
    const toolIdToName = new Map<string, string>();

    let streamMsgIndex = 0;
    // Stale replay filter (resumed sessions only):
    // stream() may replay ALL buffered messages from previous queries in one burst
    // (all at elapsed ~0ms) before delivering the current query's response.
    // We use two signals to detect when the real stream begins:
    //   1. system:init message (primary signal — CLI subprocess confirmed alive)
    //   2. Elapsed time > 3000ms (fallback — in case init is delayed by MCP startup)
    // Fresh sessions never have stale replays, so streamReady starts true.
    let streamReady = !options.resume;

    for await (const message of managed.session.stream()) {
      // Cooperative cancellation: /stop sets managed.cancelled = true
      if (managed.cancelled) {
        logger.info({ sessionId }, 'Query cancelled by user — breaking stream');
        throw new Error('Query cancelled by user');
      }

      const elapsed = Date.now() - startTime;
      logger.info(
        { sessionId, msgIndex: streamMsgIndex, msgType: message.type, msgSubtype: 'subtype' in message ? (message as { subtype?: string }).subtype : undefined, elapsed, streamReady },
        'V2 stream message received'
      );
      streamMsgIndex++;

      // Extract session_id from init and use it as the streamReady signal.
      // system:init confirms the CLI subprocess is alive and processing THIS query.
      // All messages before init are stale replays from the previous query's buffer.
      if (message.type === 'system' && 'subtype' in message) {
        const systemMsg = message as { subtype?: string; session_id?: string; hook_event?: string; hook_name?: string; outcome?: string; exit_code?: number; stderr?: string };
        if (systemMsg.subtype === 'init') {
          streamReady = true;
          if (systemMsg.session_id) {
            managed.sdkSessionId = systemMsg.session_id;
          }
        }
        // Log hook lifecycle for debugging
        if (systemMsg.subtype === 'hook_started') {
          logger.info({ sessionId, hookEvent: systemMsg.hook_event, hookName: systemMsg.hook_name }, 'V2 hook started');
        } else if (systemMsg.subtype === 'hook_response') {
          logger.info({ sessionId, hookEvent: systemMsg.hook_event, hookName: systemMsg.hook_name, outcome: systemMsg.outcome, exitCode: systemMsg.exit_code, stderr: systemMsg.stderr?.substring(0, 200) }, 'V2 hook response');
        }
      }

      // Elapsed time fallback: if enough time has passed, the real stream must have started
      // even if we never saw system:init (can happen when init is among the stale batch).
      if (!streamReady && elapsed >= 3000) {
        logger.info({ sessionId, elapsed }, 'Stream ready via elapsed time fallback (no init seen)');
        streamReady = true;
      }

      // Skip ALL stale replay messages (resumed sessions only).
      // Before streamReady, everything — including result messages from previous queries —
      // is a replay from the session's JSONL buffer. We must skip them all.
      if (!streamReady && message.type !== 'system') {
        logger.info({ sessionId, msgIndex: streamMsgIndex - 1, msgType: message.type, elapsed }, 'Skipping stale replay message');
        continue;
      }

      if (message.type === 'assistant' && message.message?.content) {
        const textParts: string[] = [];
        for (const block of message.message.content) {
          if (block.type === 'text') {
            textParts.push(block.text);
          }
        }
        const messageText = textParts.join('');
        if (messageText.length > 0) {
          if (options.onIntermediateMessage) {
            await options.onIntermediateMessage(messageText);
            intermediateCount++;
          } else {
            responseChunks.push(messageText);
          }
        }
      }

      // Tool events
      if (options.onToolEvent) {
        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'tool_use') {
              toolIdToName.set(block.id, block.name);
              await options.onToolEvent({
                type: 'tool_use',
                toolName: block.name,
                timestamp: Date.now(),
              });
            }
          }
        }

        if (message.type === 'user' && message.message?.content) {
          for (const block of message.message.content) {
            if (typeof block === 'object' && 'type' in block && block.type === 'tool_result') {
              const toolResultBlock = block as { tool_use_id?: string; content?: string };
              const toolName = toolResultBlock.tool_use_id
                ? (toolIdToName.get(toolResultBlock.tool_use_id) ?? 'tool')
                : 'tool';
              const toolEvent: ToolEvent = {
                type: 'tool_result',
                toolName,
                timestamp: Date.now(),
              };
              if (typeof toolResultBlock.content === 'string') {
                toolEvent.summary = toolResultBlock.content.substring(0, 100);
              }
              await options.onToolEvent(toolEvent);
            }
          }
        }
      }

      // Result
      if (message.type === 'result') {
        numTurns = message.num_turns ?? 0;
        durationMs = message.duration_ms ?? 0;

        const resultMsg = message as {
          total_cost_usd?: number;
          modelUsage?: Record<string, {
            inputTokens?: number;
            outputTokens?: number;
            cacheReadInputTokens?: number;
            cacheCreationInputTokens?: number;
            costUSD?: number;
          }>;
        };

        if (resultMsg.modelUsage) {
          // V2 sessions report CUMULATIVE usage across all send() calls.
          // Compute delta from previous snapshot to get per-query values.
          let cumInput = 0, cumOutput = 0, cumCacheRead = 0, cumCacheCreation = 0, cumCost = 0;
          for (const mu of Object.values(resultMsg.modelUsage)) {
            cumInput += mu.inputTokens ?? 0;
            cumOutput += mu.outputTokens ?? 0;
            cumCacheRead += mu.cacheReadInputTokens ?? 0;
            cumCacheCreation += mu.cacheCreationInputTokens ?? 0;
            cumCost += mu.costUSD ?? 0;
          }

          const prev = managed.prevUsage;
          const prevTotalCost = prev.totalCostUsd;
          const cumTotalCostVal = resultMsg.total_cost_usd ?? 0;

          // Per-query delta
          usage = {
            inputTokens: Math.max(0, cumInput - prev.inputTokens),
            outputTokens: Math.max(0, cumOutput - prev.outputTokens),
            cacheReadInputTokens: Math.max(0, cumCacheRead - prev.cacheReadInputTokens),
            cacheCreationInputTokens: Math.max(0, cumCacheCreation - prev.cacheCreationInputTokens),
            costUsd: Math.max(0, cumCost - prev.costUsd),
          };
          totalCostUsd = Math.max(0, cumTotalCostVal - prevTotalCost);

          // Update snapshot for next query
          managed.prevUsage = {
            inputTokens: cumInput,
            outputTokens: cumOutput,
            cacheReadInputTokens: cumCacheRead,
            cacheCreationInputTokens: cumCacheCreation,
            costUsd: cumCost,
            totalCostUsd: cumTotalCostVal,
          };
        } else {
          totalCostUsd = resultMsg.total_cost_usd;
        }

        if (message.subtype !== 'success') {
          const errors = 'errors' in message ? (message.errors as string[]) : [];
          const errorMsg = errors.length > 0 ? errors.join('; ') : `Query failed: ${message.subtype}`;
          throw new Error(`SDK V2 session error: ${errorMsg}`);
        }

        break; // stream() returns after result, but break explicitly
      }
    }

    const response = responseChunks.join('');

    // Cache efficiency monitoring
    let cacheEfficiency: number | undefined;
    if (usage) {
      const totalInput = (usage.inputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0);
      cacheEfficiency = totalInput > 0
        ? Math.round(((usage.cacheReadInputTokens ?? 0) / totalInput) * 100)
        : 0;
    }

    logger.info(
      {
        sessionId,
        sdkSessionId: managed.sdkSessionId,
        responseLength: response.length,
        numTurns,
        durationMs: Date.now() - startTime,
        sessionMessageCount: managed.messageCount,
        ...(usage ? {
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadInputTokens,
            cacheCreationTokens: usage.cacheCreationInputTokens,
            costUsd: usage.costUsd,
            cacheEfficiencyPct: cacheEfficiency,
          },
          totalCostUsd,
        } : {}),
      },
      `V2 session query completed (cache efficiency: ${cacheEfficiency ?? 'N/A'}%, msg #${managed.messageCount})`
    );

    const queryResult: QueryResult = {
      response,
      sdkSessionId: managed.sdkSessionId,
      numTurns,
      durationMs,
      intermediateMessageCount: intermediateCount,
      isUsageDelta: true, // V2 delta already computed above
    };
    if (usage) queryResult.usage = usage;
    if (totalCostUsd !== undefined) queryResult.totalCostUsd = totalCostUsd;

    return queryResult;
  }

  /**
   * Destroy a specific session
   */
  destroySession(sessionId: string): void {
    const managed = this.sessions.get(sessionId);
    if (managed) {
      try {
        managed.session.close();
      } catch { /* ignore close errors */ }
      this.sessions.delete(sessionId);
      logger.info({ sessionId }, 'V2 session destroyed');
    }
  }

  /**
   * Check if a persistent session exists for the given ID
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Check if a session has an active query in progress (send + processStream running)
   */
  hasActiveQuery(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.isQuerying === true;
  }

  /**
   * Cancel an active query by closing the session.
   * Returns true only if a query was actually running; false if session is idle or absent.
   */
  cancelActiveQuery(sessionId: string): boolean {
    const managed = this.sessions.get(sessionId);
    if (!managed?.isQuerying) {
      return false;
    }
    // Two-phase cancel:
    // 1. Set cancelled flag — processStream checks this on each iteration to break the loop
    // 2. close() kills the CLI subprocess — accelerates stream break on Windows
    // Session cleanup (delete from Map) is NOT done here — executeQuery's catch block handles it
    // to avoid double-destroy and keep cleanup responsibility in one place.
    managed.cancelled = true;
    logger.info({ sessionId, sdkSessionId: managed.sdkSessionId }, 'Cancelling active V2 query');
    try { managed.session.close(); } catch { /* ignore close errors */ }
    return true;
  }

  /**
   * Get session stats
   */
  getSessionStats(sessionId: string): { messageCount: number; ageMs: number } | null {
    const managed = this.sessions.get(sessionId);
    if (!managed) return null;
    return {
      messageCount: managed.messageCount,
      ageMs: Date.now() - managed.createdAt,
    };
  }

  /**
   * Dispose all sessions
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const [sessionId] of this.sessions) {
      this.destroySession(sessionId);
    }
  }
}
