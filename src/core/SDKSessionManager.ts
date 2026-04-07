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
  additionalDirectories?: string[];
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
  /** Cache keepalive timer — pings session to prevent Anthropic API cache TTL expiry */
  keepaliveTimer?: ReturnType<typeof setInterval> | undefined;
  /** Rolling cache efficiency (0-100) for monitoring */
  cacheEfficiencyAvg?: number | undefined;
  /** Stream iterator preserved across queries for background drain */
  streamIterator?: AsyncIterator<any>;
  /** Whether background drain is actively consuming the stream */
  bgDrainActive?: boolean;
  /** Resolved when bgDrainActive transitions to false — used by stopBackgroundDrain */
  bgDrainDone?: () => void;
  /** Callback to push messages between queries (stored from last processStream) */
  onIntermediateMessage?: (text: string) => void | Promise<void>;
}

/**
 * Manages persistent SDK V2 sessions for agent conversations.
 *
 * Key difference from SDKQueryManager:
 * - V1 (old): each executeQuery() spawns new CLI process → cache bust
 * - V2 (this): process stays alive between messages → cache persists
 */
/**
 * Cache keepalive interval. Anthropic API cache TTL:
 * - Standard accounts: 5 minutes
 * - Claude Max / first-party: up to 1 hour (if querySource is in allowlist)
 * We use a conservative 4-minute interval to cover the 5-min minimum TTL.
 * The ping is cheap (~10 output tokens) vs cache rebuild cost (125% of full context).
 */
const CACHE_KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes
/** Skip keepalive if session was used recently (within this window) */
const CACHE_KEEPALIVE_SKIP_IF_RECENT_MS = 3 * 60 * 1000; // 3 minutes
/** Cache efficiency threshold — warn if rolling average drops below this */
const CACHE_EFFICIENCY_WARN_THRESHOLD = 50;
/** Sentinel used by Promise.race to distinguish a timeout from a real stream message */
const DRAIN_SENTINEL = Symbol('drain-timeout');

/**
 * Extract assistant text from a stream message.
 * Returns concatenated text content, or an empty string if the message is not
 * an assistant message or contains no text blocks.
 */
function extractAssistantText(msg: any): string {
  if (msg.type !== 'assistant' || !msg.message?.content) return '';
  const parts: string[] = [];
  for (const block of msg.message.content) {
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('');
}

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

    // Stop background drain before starting new query
    await this.stopBackgroundDrain(managed);

    // Store callback for background drain to use between queries
    if (options.onIntermediateMessage) {
      managed.onIntermediateMessage = options.onIntermediateMessage;
    }

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
        // Start background drain — keep pushing any stray messages between queries
        this.startBackgroundDrain(sessionId, managed);
        return freshResult;
      }

      // Start background drain — keep pushing any stray messages between queries
      this.startBackgroundDrain(sessionId, managed);
      return result;
    } catch (error) {
      // SDK abort may throw non-Error values like { value: "..." }
      const errDetail = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'value' in error
          ? String((error as { value: unknown }).value)
          : String(error);

      // Preserve sdkSessionId before destroying — allows caller to save it for resume
      const preservedSdkSessionId = managed.sdkSessionId;
      const wasCancelled = managed.cancelled === true;

      logger.warn(
        { sessionId, error: errDetail, sdkSessionId: preservedSdkSessionId, wasCancelled },
        'V2 session error, cleaning up'
      );
      this.destroySession(sessionId);

      // Attach sdkSessionId to the error so caller can persist it for resume
      if (preservedSdkSessionId) {
        if (error instanceof Error) {
          (error as Error & { _sdkSessionId?: string })._sdkSessionId = preservedSdkSessionId;
        } else if (typeof error === 'object' && error !== null) {
          (error as Record<string, unknown>)._sdkSessionId = preservedSdkSessionId;
        }
      }
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
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', // Skip quota probe, metrics export, bootstrap, changelog
      },
    };

    // Shared skills directory: --add-dir for cross-agent shared skills
    if (options.additionalDirectories && options.additionalDirectories.length > 0) {
      sessionOptions.additionalDirectories = options.additionalDirectories;
    }

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

    // Thinking config: control extended thinking behavior.
    // Default to disabled to save tokens unless agent explicitly enables it.
    if (agent.config.settings?.thinking) {
      sessionOptions.thinking = agent.config.settings.thinking as { type: string };
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
      PreCompact: [{
        matcher: '',
        hooks: [async (input: unknown) => {
          const { trigger } = input as { trigger?: string };
          logger.info({ sessionId, trigger }, 'Context compaction triggered');
          // Approve compaction — the keepalive timer will handle cache warmup after
          return { decision: 'approve' as const };
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

    // Start cache keepalive timer to prevent API prompt cache TTL expiry
    this.startKeepalive(sessionId);

    logger.info(
      {
        sessionId,
        sdkSessionId,
        hasResume: !!options.resume,
        keepaliveIntervalMs: CACHE_KEEPALIVE_INTERVAL_MS,
        sessionOpts: {
          model: sessionOptions.model,
          cwd: sessionOptions.cwd,
          settingSources: sessionOptions.settingSources,
          permissionMode: sessionOptions.permissionMode,
          allowedToolsCount: sessionOptions.allowedTools?.length ?? 0,
          hasMcpServers: sessionOptions.mcpServers ? Object.keys(sessionOptions.mcpServers).length : 0,
        },
      },
      'V2 persistent session created (with cache keepalive)'
    );

    return managed;
  }

  /**
   * Start background drain: keep reading the stream between queries.
   * Any assistant messages that arrive (hooks, bg-tasks) are pushed to the user immediately.
   * Stops when the next query starts or the session is destroyed.
   */
  private startBackgroundDrain(sessionId: string, managed: ManagedSession): void {
    if (!managed.streamIterator || !managed.onIntermediateMessage) return;
    if (managed.bgDrainActive) return;

    managed.bgDrainActive = true;
    const iterator = managed.streamIterator;
    const onMsg = managed.onIntermediateMessage;

    // Register drain-done signal so stopBackgroundDrain can await instead of blind-sleeping
    const drainDonePromise = new Promise<void>(resolve => {
      managed.bgDrainDone = resolve;
    });
    void drainDonePromise; // suppress unused-variable lint

    (async () => {
      while (managed.bgDrainActive && !managed.isQuerying) {
        try {
          const raceResult = await Promise.race([
            iterator.next(),
            new Promise<typeof DRAIN_SENTINEL>(resolve =>
              setTimeout(() => resolve(DRAIN_SENTINEL), 5000)
            ),
          ]);

          if (raceResult === DRAIN_SENTINEL) continue; // No message, keep waiting
          const { done, value: msg } = raceResult as IteratorResult<any>;
          if (done) break;

          // Push assistant text to user immediately
          const text = extractAssistantText(msg);
          if (text.length > 0) {
            try {
              await onMsg(text);
            } catch (err) {
              logger.warn({ sessionId, error: err }, 'Background drain: failed to push message');
            }
          }

          logger.debug({ sessionId, msgType: msg.type }, 'Background drain: consumed message');
        } catch (err) {
          logger.warn({ sessionId, error: err }, 'Background drain: iteration error');
          break;
        }
      }
      managed.bgDrainActive = false;
      managed.bgDrainDone?.();
      logger.debug({ sessionId }, 'Background drain stopped');
    })();
  }

  /**
   * Stop background drain before starting a new query.
   */
  private async stopBackgroundDrain(managed: ManagedSession): Promise<void> {
    if (!managed.bgDrainActive) return;
    // Signal the loop to stop, then await its completion via the stored resolve callback.
    // Fall back to a 300ms timeout if bgDrainDone was never set (shouldn't happen).
    const done = new Promise<void>(resolve => {
      const prev = managed.bgDrainDone;
      managed.bgDrainDone = () => { prev?.(); resolve(); };
    });
    managed.bgDrainActive = false;
    await Promise.race([done, new Promise<void>(resolve => setTimeout(resolve, 300))]);
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
    // Stale message filter — two modes:
    //
    // 1. Resumed sessions (new CLI process):
    //    stream() replays ALL buffered JSONL messages before delivering current query's response.
    //    We wait for system:init (or 3s fallback) to mark the real stream start.
    //
    // 2. Persistent sessions (CLI process stays alive, messageCount >= 2):
    //    stream() replays the ENTIRE conversation history (system:init + all user/assistant pairs)
    //    in rapid bursts before delivering the new query's response.
    //    We skip replay by counting result messages: each previous query produced exactly one
    //    result, so we skip until we've seen (messageCount - 1) results. Deterministic, no timing hacks.
    //
    // Both modes use streamReady=false to gate message delivery.
    //
    // NOTE: messageCount is already incremented before processStream, so >= 2 means
    // there was at least one prior query with a result to replay.
    const isPersistentFollowUp = !options.resume && managed.messageCount >= 2;
    // Fresh sessions (not resume, not persistent follow-up) have no prior history to replay,
    // so streamReady starts true — all messages are real from the first one.
    let streamReady = !options.resume && !isPersistentFollowUp;
    // Result-counting replay detection (fast path): each previous query produced one result,
    // so we skip until we've seen (messageCount - 1) results. Instant streamReady when it works.
    const expectedReplayResults = isPersistentFollowUp ? managed.messageCount - 1 : 0;
    let replayResultCount = 0;
    // Gap detection fallback: if SDK doesn't replay result messages, fall back to timing heuristics.
    // Initialized to 0 — set to Date.now() on the first replay message to avoid inflating the
    // first gap measurement with time elapsed before the stream loop started.
    let lastReplayMsgTime = 0;

    // Manual iteration (not for-await) so that break does NOT call iterator.return().
    // This keeps the iterator alive for the post-result drain phase.
    // Create new iterator for this query (stream() replays conversation + new response)
    const streamIterator = (managed.session.stream() as AsyncIterable<any>)[Symbol.asyncIterator]();
    // Store on managed session so background drain can continue using it after processStream
    managed.streamIterator = streamIterator;
    while (true) {
      const __iterResult = await streamIterator.next();
      if (__iterResult.done) break;
      const message = __iterResult.value;

      // Cooperative cancellation: /stop sets managed.cancelled = true
      if (managed.cancelled) {
        logger.info({ sessionId }, 'Query cancelled by user — breaking stream');
        throw new Error('Query cancelled by user');
      }

      const elapsed = Date.now() - startTime;
      if (streamReady) {
        logger.info(
          { sessionId, msgIndex: streamMsgIndex, msgType: message.type, msgSubtype: 'subtype' in message ? (message as { subtype?: string }).subtype : undefined, elapsed, streamReady },
          'V2 stream message received'
        );
      } else {
        logger.debug(
          { sessionId, msgIndex: streamMsgIndex, msgType: message.type, msgSubtype: 'subtype' in message ? (message as { subtype?: string }).subtype : undefined, elapsed, streamReady },
          'V2 stream message received (replay)'
        );
      }
      streamMsgIndex++;

      // Extract session_id from init.
      // For resumed sessions (new CLI process), init = reliable streamReady signal.
      // For persistent follow-ups, init arrives WITHIN the replay batch (same timestamp
      // as buffered history messages), so it must NOT set streamReady — persistent
      // follow-ups use result counting + gap detection, not the init message.
      if (message.type === 'system' && 'subtype' in message) {
        const systemMsg = message as { subtype?: string; session_id?: string; hook_event?: string; hook_name?: string; outcome?: string; exit_code?: number; stderr?: string };
        if (systemMsg.subtype === 'init') {
          if (!isPersistentFollowUp) {
            streamReady = true;
          }
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

      // Persistent follow-up: skip replay messages using a two-tier strategy.
      //
      // Fast path (result counting): each previous query produced one result message.
      // Count replayed results — when we've seen (messageCount - 1), replay is over. Instant.
      //
      // Fallback (gap detection): if SDK doesn't replay result messages, detect the
      // timing gap between rapid-fire replay burst and the real response (model thinking time).
      if (isPersistentFollowUp && !streamReady) {
        const now = Date.now();
        // Initialize lastReplayMsgTime on the first replay message (not before the loop)
        // to avoid inflating the first gap with time spent before iteration started.
        if (lastReplayMsgTime === 0) lastReplayMsgTime = now;
        const gapMs = now - lastReplayMsgTime;

        // Fast path: count replayed results
        if (message.type === 'result') {
          replayResultCount++;
          if (replayResultCount >= expectedReplayResults) {
            logger.info(
              { sessionId, replayResultCount, expectedReplayResults, elapsed },
              'Stream ready via result counting (persistent follow-up)'
            );
            streamReady = true;
          }
        }

        // Fallback: gap detection (only if result counting hasn't triggered yet)
        if (!streamReady && ((elapsed >= 2000 && gapMs >= 1000) || elapsed >= 5000)) {
          logger.info(
            { sessionId, elapsed, gapMs, replayResultCount, expectedReplayResults, msgType: message.type },
            'Stream ready via gap detection fallback (persistent follow-up)'
          );
          streamReady = true;
        }

        if (!streamReady) {
          lastReplayMsgTime = now;
          continue; // Still replaying — skip
        }
        // Both branches fall through here — skip boundary message
        // (either the replayed result that triggered result-counting, or the gap-trigger message)
        continue;
      }

      // Elapsed time fallback: if init never arrives, force streamReady.
      // Resume sessions need longer timeout (CLI cold start can take 10-30s).
      // Non-resume, non-persistent-followup sessions use a shorter timeout.
      const fallbackMs = options.resume ? 30000 : 3000;
      if (!streamReady && elapsed >= fallbackMs) {
        logger.info({ sessionId, elapsed, isResume: !!options.resume }, 'Stream ready via elapsed time fallback');
        streamReady = true;
      }

      // Skip stale replay messages (resumed sessions only — NOT persistent follow-up).
      // Before streamReady, everything is a JSONL replay. We must skip them all.
      if (!streamReady && message.type !== 'system') {
        logger.debug({ sessionId, msgIndex: streamMsgIndex - 1, msgType: message.type, elapsed }, 'Skipping stale replay message');
        continue;
      }

      const messageText = extractAssistantText(message);
      if (messageText.length > 0) {
        if (options.onIntermediateMessage) {
          await options.onIntermediateMessage(messageText);
          intermediateCount++;
        } else {
          responseChunks.push(messageText);
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

        break; // Exit main loop — drain phase below will catch trailing messages
      }
    }

    // Post-result drain: keep reading the stream with a timeout to push any trailing
    // messages (hooks, bg-tasks) to the user immediately instead of letting them
    // accumulate in the buffer and pollute the next query as stale replay.
    //
    // Because we used manual iteration (not for-await), the iterator is still alive
    // after break — we can continue reading from it.
    // Promise.race with timeout prevents blocking if no more messages arrive.
    {
      const DRAIN_TIMEOUT_MS = 3000;
      const drainDeadline = Date.now() + DRAIN_TIMEOUT_MS;

      while (true) {
        const remaining = drainDeadline - Date.now();
        if (remaining <= 0) break;

        const raceResult = await Promise.race([
          streamIterator.next(),
          new Promise<typeof DRAIN_SENTINEL>(resolve =>
            setTimeout(() => resolve(DRAIN_SENTINEL), remaining)
          ),
        ]);

        if (raceResult === DRAIN_SENTINEL) {
          logger.debug({ sessionId }, 'Post-result drain timeout — no more trailing messages');
          break;
        }

        const { done, value: drainMsg } = raceResult as IteratorResult<any>;
        if (done) break;

        // Push assistant text to user immediately (same path as main loop)
        const drainText = extractAssistantText(drainMsg);
        if (drainText.length > 0) {
          if (options.onIntermediateMessage) {
            await options.onIntermediateMessage(drainText);
            intermediateCount++;
          } else {
            responseChunks.push(drainText);
          }
        }

        logger.debug(
          { sessionId, msgType: drainMsg.type },
          'Drained post-result stream message'
        );
      }
    }

    const response = responseChunks.join('');

    // Cache efficiency monitoring + rolling average tracking
    let cacheEfficiency: number | undefined;
    if (usage) {
      const totalInput = (usage.inputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0);
      cacheEfficiency = totalInput > 0
        ? Math.round(((usage.cacheReadInputTokens ?? 0) / totalInput) * 100)
        : 0;
      this.updateCacheEfficiency(sessionId, managed, usage);
    }

    logger.info(
      {
        sessionId,
        sdkSessionId: managed.sdkSessionId,
        responseLength: response.length,
        numTurns,
        wallClockMs: Date.now() - startTime,
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
      // Clear keepalive timer first
      if (managed.keepaliveTimer) {
        clearInterval(managed.keepaliveTimer);
        managed.keepaliveTimer = undefined;
      }
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
   * Start cache keepalive timer for a session.
   * Sends lightweight pings to prevent Anthropic API prompt cache TTL expiry.
   * Cost: ~10 output tokens per ping vs ~125% of full context on cache rebuild.
   */
  private startKeepalive(sessionId: string): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    // Clear existing timer if any
    if (managed.keepaliveTimer) {
      clearInterval(managed.keepaliveTimer);
    }

    managed.keepaliveTimer = setInterval(async () => {
      const current = this.sessions.get(sessionId);
      if (!current || current.isQuerying || this.disposed) return;

      // Skip if session was used recently
      const idleMs = Date.now() - current.lastUsedAt;
      if (idleMs < CACHE_KEEPALIVE_SKIP_IF_RECENT_MS) return;

      try {
        logger.debug({ sessionId, idleMs }, 'Cache keepalive ping');
        await current.session.send("Reply with only 'ok'");
        current.lastUsedAt = Date.now();

        // Drain the stream (consume the response without processing)
        for await (const message of current.session.stream()) {
          if (message.type === 'result') break;
        }
        logger.debug({ sessionId }, 'Cache keepalive ping completed');
      } catch (err) {
        // Keepalive failure is non-critical — log and continue
        // Session may have died; it will be recreated on next real query
        logger.warn(
          { sessionId, err: err instanceof Error ? err.message : String(err) },
          'Cache keepalive ping failed'
        );
        // Stop keepalive for this session to avoid repeated failures
        if (current.keepaliveTimer) {
          clearInterval(current.keepaliveTimer);
          current.keepaliveTimer = undefined;
        }
      }
    }, CACHE_KEEPALIVE_INTERVAL_MS);
  }

  /**
   * Update rolling cache efficiency average and warn if below threshold.
   */
  private updateCacheEfficiency(sessionId: string, managed: ManagedSession, usage: QueryUsage): void {
    const totalInput = (usage.inputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0);
    if (totalInput === 0) return;

    const efficiency = Math.round(((usage.cacheReadInputTokens ?? 0) / totalInput) * 100);

    // Exponential moving average (alpha = 0.3 for responsiveness)
    const prev = managed.cacheEfficiencyAvg ?? efficiency;
    managed.cacheEfficiencyAvg = Math.round(prev * 0.7 + efficiency * 0.3);

    if (managed.messageCount > 2 && managed.cacheEfficiencyAvg < CACHE_EFFICIENCY_WARN_THRESHOLD) {
      logger.warn(
        {
          sessionId,
          currentEfficiency: efficiency,
          rollingAvg: managed.cacheEfficiencyAvg,
          messageCount: managed.messageCount,
          threshold: CACHE_EFFICIENCY_WARN_THRESHOLD,
        },
        `Cache efficiency below ${CACHE_EFFICIENCY_WARN_THRESHOLD}% — possible cache bust issue`
      );
    }
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
