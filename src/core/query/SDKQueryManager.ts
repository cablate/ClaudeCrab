import { query, type Query, type Options, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { LoadedAgent } from '../../types/agent.js';
import type { ToolEvent } from '../../types/message.js';
import type { ContextUsageSnapshot } from '../keepalive/ContextUsageTelemetry.js';
import type { ConversationRuntimeContext } from '../../types/runtimeContext.js';
import type { SubAgentEvent } from './SubAgentMessageManager.js';
import { logger } from '../../utils/logger.js';
import { resolveCliPath } from '../../utils/cliPath.js';
import { sanitizeBeforeResume } from '../lib/JsonlSanitizer.js';

/**
 * Token usage breakdown from SDK result (ADR-020 Phase 2)
 */
export interface QueryUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
}

export interface QueryModelUsage extends QueryUsage {
  webSearchRequests?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
}

/**
 * Result of executing a query
 */
export interface QueryResult {
  /** The response text from Claude */
  response: string;

  /** SDK session ID for future resume */
  sdkSessionId: string;

  /** Number of turns used */
  numTurns?: number;

  /** Duration in milliseconds */
  durationMs?: number;

  /** Number of intermediate messages delivered via onIntermediateMessage callback */
  intermediateMessageCount?: number;

  /** Token usage breakdown (ADR-020 Phase 2) */
  usage?: QueryUsage;

  /** Total cost in USD from SDK (ADR-020 Phase 2) */
  totalCostUsd?: number;

  /** If true, usage values are already per-query deltas (V2 path). If false/undefined, they may be cumulative (V1 with resume). */
  isUsageDelta?: boolean;

  /** If true, the session resume failed and a fresh session was created ??conversation history is lost. */
  resumeLost?: boolean;

  /** If true, the persistent session returned 0 turns and was proactively destroyed. Caller should notify user. */
  sessionDegraded?: boolean;

  /** Estimated context size from the last API turn's per-turn usage (input + cache_read + cache_creation). */
  contextTokens?: number;

  /** Actual model IDs reported by SDK result.modelUsage for this query. */
  actualModels?: string[];

  /** Resolved main-session model ID, used to split main vs subagent usage. */
  mainModel?: string;

  /** Per-model usage reported by SDK result.modelUsage. V2 fills per-query deltas. */
  modelUsage?: Record<string, QueryModelUsage>;

  /** SDK getContextUsage() breakdown. V2 only. */
  contextUsage?: ContextUsageSnapshot;
}

/**
 * Options for executing a query
 */
export interface ExecuteQueryOptions {
  /** Working directory (agent path) */
  cwd: string;

  /** SDK session ID to resume (for multi-turn conversations) */
  resume?: string | undefined;

  /** Maximum turns per query (default: 1) */
  maxTurns?: number;

  /**
   * System prompt to use directly.
   * This bypasses SDK's CLAUDE.md search to ensure agent isolation
   * (prevents loading parent directory's CLAUDE.md).
   */
  systemPrompt?: string;

  /**
   * Setting sources to load.
   * Default: ['local'] - loads .claude/settings.local.json (agent permissions)
   * Note: 'project' would search parent directories for CLAUDE.md, avoid using it.
   */
  settingSources?: Array<'user' | 'project' | 'local'>;

  /** Additional SDK options */
  additionalOptions?: Partial<Options>;

  /** Runtime provenance used only for diagnostics, alerts, and ops commands. */
  runtimeContext?: ConversationRuntimeContext;

  /**
   * Called when an intermediate assistant message is received during multi-turn processing.
   * When provided, the message text will NOT be included in the final QueryResult.response,
   * avoiding duplicate delivery.
   * If the callback returns a Promise, it will be awaited before continuing iteration.
   */
  onIntermediateMessage?: (text: string) => void | Promise<void>;

  /**
   * Called when a tool event occurs during query execution.
   * Used for real-time status updates (e.g., showing which tool is being used).
   * Events include: tool_use (started), tool_result (completed), tool_progress (in-progress updates).
   */
  onToolEvent?: (event: ToolEvent) => void | Promise<void>;

  /**
   * Called when an SDK programmatic callback hook fires or completes.
   * Surfaces hook lifecycle to chat adapters so users see real-time feedback
   * (UserPromptSubmit injection preview, PreToolUse governance, PreCompact).
   * SDK's native `hook_started`/`hook_response` stream events don't fire for
   * programmatic callbacks ??we instrument each callback site. See
   * src/types/hookEvent.ts and memory project_sdk-callback-hook-invisibility.
   */
  onHookEvent?: (event: import('../../types/hookEvent.js').HookEvent) => void | Promise<void>;

  /**
   * Called when a sub-agent task_notification event is received from the SDK.
   * Used to update Discord UI with sub-agent lifecycle progress.
   */
  onSubAgentEvent?: (event: SubAgentEvent) => void | Promise<void>;

  /**
   * SubAgentMessageManager instance for managing sub-agent Discord UI.
   * When provided, sub-agent lifecycle events are routed to Discord messages.
   */
  subAgentManager?: import('./SubAgentMessageManager.js').SubAgentMessageManager;

  /**
   * Custom MCP servers to inject into the query.
   * Used for cross-agent notification and other custom tools.
   * Note: When mcpServers is provided, prompt will be wrapped in AsyncIterable format.
   */
  mcpServers?: Record<string, McpSdkServerConfigWithInstance>;

  /**
   * List of allowed tool names when using custom MCP servers.
   * Format: mcp__{server_name}__{tool_name}
   */
  allowedTools?: string[];

  /**
   * Additional directories to scan for shared skills (.claude/skills/).
   * Maps to CLI --add-dir flag. Used for cross-agent shared skill directories.
   */
  additionalDirectories?: string[];

  /**
   * When true, resume failure throws instead of falling back to a fresh session.
   * Used for schedule-thread pending handoff where fresh conversation is forbidden.
   */
  requireResume?: boolean;
}

/**
 * Active query state
 */
interface ActiveQuery {
  query: Query;
  abortController: AbortController;
  startTime: number;
}

/**
 * Manages SDK query execution for MessageProcessor.
 *
 * This class encapsulates the Claude Agent SDK query() function,
 * providing a simpler interface for request-response style conversations
 * used by the Discord bot runtime.
 *
 * Key features:
 * - Uses `resume` option to restore conversation history
 * - Extracts session_id from SDK responses for future resume
 * - Manages active queries for cancellation support
 * - Collects streaming responses into complete text
 */
export class SDKQueryManager {
  /** Active queries by session ID */
  private readonly activeQueries: Map<string, ActiveQuery> = new Map();

  /** Whether the manager has been disposed */
  private disposed = false;

  /**
   * Execute a query and return the response.
   *
   * @param sessionId - ClaudeCab session ID (for tracking active queries)
   * @param prompt - User message
   * @param agent - Loaded agent configuration
   * @param options - Query options
   * @returns Query result with response and SDK session ID
   */
  async executeQuery(
    sessionId: string,
    prompt: string,
    agent: LoadedAgent,
    options: ExecuteQueryOptions
  ): Promise<QueryResult> {
    if (this.disposed) {
      throw new Error('SDKQueryManager has been disposed');
    }

    // Cancel any existing query for this session
    this.cancelQuery(sessionId);

    const abortController = new AbortController();
    const startTime = Date.now();

    // Build SDK options
    // Use 'project' to auto-load CLAUDE.md from cwd and parent directories
    // Use 'local' to load permissions from .claude/settings.local.json
    // SDK automatically loads CLAUDE.md when settingSources includes 'project',
    // so we don't need to manually append systemPrompt anymore.
    // When CLAUDE_CLI_PATH is set, resolve and pass to SDK.
    // When empty/unset, let SDK use its own bundled CLI from node_modules.
    const customCliPath = process.env.CLAUDE_CLI_PATH?.trim();
    let resolvedCliPath: string | undefined;
    if (customCliPath) {
      const resolved = await resolveCliPath(customCliPath);
      if (resolved) {
        resolvedCliPath = resolved.path;
        if (resolved.fallback) {
          logger.warn(
            { configured: customCliPath, resolved: resolved.path },
            'SDKQueryManager: CLAUDE_CLI_PATH missing; resolved to alternate'
          );
        }
      } else {
        logger.error(
          { configured: customCliPath },
          'SDKQueryManager: CLAUDE_CLI_PATH does not exist and no alternate found ??SDK will throw'
        );
      }
    }

    const sdkOptions: Options = {
      cwd: options.cwd,
      settingSources: options.settingSources ?? ['project', 'local'],
      // Only set maxTurns if explicitly provided, otherwise let SDK use its default
      ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
      ...(resolvedCliPath ? { pathToClaudeCodeExecutable: resolvedCliPath } : {}),
      abortController,
      // Use Claude Code preset; append agent's systemPrompt if provided
      // (settingSources loads CLAUDE.md from cwd, but append ensures fresh-read via getSystemPrompt works)
      systemPrompt: options.systemPrompt
        ? { type: 'preset' as const, preset: 'claude_code' as const, append: options.systemPrompt }
        : { type: 'preset' as const, preset: 'claude_code' as const },
      // Resume from previous session if provided
      ...(options.resume ? { resume: options.resume } : {}),
      // Merge additional options
      ...options.additionalOptions,
      // === Cache Bust Mitigation ===
      // CLAUDE_CODE_REMOTE=1 skips runtime git status injection (sf8/mw functions in cli.js).
      // See: docs/upgrades/research/sdk-reverse-engineering-v0.2.76.md
      env: {
        ...options.additionalOptions?.env,
        CLAUDE_CODE_REMOTE: '1',
      },
    };

    // Log detailed SDK options for debugging.
    // SDK 0.2.119 union: string | string[] | { type: 'preset'; preset: 'claude_code'; append?; excludeDynamicSections? }
    const sp = sdkOptions.systemPrompt;
    const systemPromptStr: string | null =
      typeof sp === 'string'
        ? sp
        : Array.isArray(sp)
          ? `[array: ${sp.length} entries]`
          : sp?.type === 'preset'
            ? `[preset: ${sp.preset}+append(${(sp.append ?? '').length}chars)]`
            : null;

    logger.info(
      {
        sessionId,
        agentId: agent.id,
        promptPreview: prompt.substring(0, 300) + (prompt.length > 300 ? '...' : ''),
        promptLength: prompt.length,
        hasInjectedContext: prompt.includes('[群�?對話紀?�]'),
        sdkOptions: {
          cwd: sdkOptions.cwd,
          settingSources: sdkOptions.settingSources,
          maxTurns: sdkOptions.maxTurns,
          hasSystemPrompt: !!sdkOptions.systemPrompt,
          systemPromptPreview: systemPromptStr
            ? systemPromptStr.substring(0, 100) + (systemPromptStr.length > 100 ? '...' : '')
            : '(none)',
          resume: sdkOptions.resume ?? '(new session)',
        },
      },
      'Starting SDK query with options'
    );

    // Create query
    // When mcpServers is provided, wrap prompt in AsyncIterable format (SDK requirement)
    const hasMcpServers = options.mcpServers && Object.keys(options.mcpServers).length > 0;

    // Add mcpServers to SDK options if provided
    if (hasMcpServers && options.mcpServers) {
      (sdkOptions as Options & { mcpServers: Record<string, McpSdkServerConfigWithInstance> }).mcpServers = options.mcpServers;
      if (options.allowedTools) {
        sdkOptions.allowedTools = options.allowedTools;
      }
      logger.info(
        { sessionId, mcpServers: Object.keys(options.mcpServers) },
        'Custom MCP servers enabled for query'
      );
    }

    // Create async generator for prompt when MCP servers are used
    // SDKUserMessage requires parent_tool_use_id and session_id fields
    // eslint-disable-next-line @typescript-eslint/require-await -- SDK expects AsyncIterable
    async function* generatePromptMessages() {
      yield {
        type: 'user' as const,
        message: {
          role: 'user' as const,
          content: prompt,
        },
        parent_tool_use_id: null,
        session_id: options.resume ?? '',
      };
    }

    // Sanitize JSONL before resume to prevent C26 readFileState diff injection
    if (options.resume) {
      sanitizeBeforeResume(options.cwd, options.resume);
    }

    const q = query({
      prompt: hasMcpServers ? generatePromptMessages() : prompt,
      options: sdkOptions,
    });

    // Track active query
    this.activeQueries.set(sessionId, {
      query: q,
      abortController,
      startTime,
    });

    try {
      const responseChunks: string[] = [];
      let sdkSessionId = '';
      let numTurns = 0;
      let durationMs = 0;
      let intermediateCount = 0;
      let usage: QueryUsage | undefined;
      let totalCostUsd: number | undefined;
      let modelUsage: Record<string, QueryModelUsage> | undefined;
      let actualModels: string[] | undefined;
      // Track tool_use_id -> tool_name mapping for tool_result events
      const toolIdToName = new Map<string, string>();

      // Process SDK messages
      for await (const message of q) {
        // Log SDK init message for debugging
        if (message.type === 'system' && 'subtype' in message) {
          const systemMsg = message as { subtype?: string; model?: string; cwd?: string; session_id?: string };
          if (systemMsg.subtype === 'init') {
            logger.info(
              {
                sessionId,
                sdkInit: {
                  model: systemMsg.model,
                  cwd: systemMsg.cwd,
                  sdkSessionId: systemMsg.session_id,
                },
              },
              'SDK initialized'
            );
          }
        }

        // Extract session_id from any message that has it
        if ('session_id' in message && message.session_id) {
          sdkSessionId = message.session_id;
        }

        // Collect assistant response text
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

        // Handle tool events for status updates
        if (options.onToolEvent) {
          // tool_use: when a tool is being called
          if (message.type === 'assistant' && message.message?.content) {
            for (const block of message.message.content) {
              if (block.type === 'tool_use') {
                // Track tool_use_id -> name mapping for tool_result lookup
                toolIdToName.set(block.id, block.name);
                await options.onToolEvent({
                  type: 'tool_use',
                  toolName: block.name,
                  timestamp: Date.now(),
                  scope: 'main',
                });
              } else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.length > 0) {
                await options.onToolEvent({
                  type: 'thinking',
                  toolName: 'thinking',
                  summary: block.thinking,
                  timestamp: Date.now(),
                  scope: 'main',
                });
              }
            }
          }

          // tool_result: when a tool returns
          if (message.type === 'user' && message.message?.content) {
            for (const block of message.message.content) {
              if (typeof block === 'object' && 'type' in block && block.type === 'tool_result') {
                const toolResultBlock = block as { tool_use_id?: string; content?: string };
                // Look up the actual tool name from our mapping
                const toolName = toolResultBlock.tool_use_id 
                  ? (toolIdToName.get(toolResultBlock.tool_use_id) ?? 'tool')
                  : 'tool';
                const toolEvent: ToolEvent = {
                  type: 'tool_result',
                  toolName,
                  timestamp: Date.now(),
                  scope: 'main',
                };
                if (typeof toolResultBlock.content === 'string') {
                  toolEvent.summary = toolResultBlock.content.substring(0, 100);
                }
                await options.onToolEvent(toolEvent);
              }
            }
          }

          // tool_progress: SDK's built-in progress events
          if (message.type === 'tool_progress') {
            const progressMsg = message as { tool_name?: string; elapsed_time_seconds?: number };
            const toolEvent: ToolEvent = {
              type: 'tool_progress',
              toolName: progressMsg.tool_name ?? 'unknown',
              timestamp: Date.now(),
              scope: 'main',
            };
            if (progressMsg.elapsed_time_seconds !== undefined) {
              toolEvent.elapsedSeconds = progressMsg.elapsed_time_seconds;
            }
            await options.onToolEvent(toolEvent);
          }

          // tool_use_summary: SDK's summary of tool usage
          if (message.type === 'tool_use_summary') {
            const summaryMsg = message as { tool_name?: string; summary?: string };
            const toolEvent: ToolEvent = {
              type: 'tool_use',
              toolName: summaryMsg.tool_name ?? 'unknown',
              timestamp: Date.now(),
              scope: 'main',
            };
            if (summaryMsg.summary !== undefined) {
              toolEvent.summary = summaryMsg.summary;
            }
            await options.onToolEvent(toolEvent);
          }
        }

        // Handle result message (query complete)
        if (message.type === 'result') {
          // Capture common fields
          numTurns = message.num_turns ?? 0;
          durationMs = message.duration_ms ?? 0;

          // ADR-020 Phase 2: Capture token usage from SDK result
          const resultMsg = message as {
            total_cost_usd?: number;
            modelUsage?: Record<string, {
              inputTokens?: number;
              outputTokens?: number;
              cacheReadInputTokens?: number;
              cacheCreationInputTokens?: number;
              webSearchRequests?: number;
              costUSD?: number;
              contextWindow?: number;
              maxOutputTokens?: number;
            }>;
          };

          if (resultMsg.modelUsage) {
            let input = 0, output = 0, cacheRead = 0, cacheCreation = 0, cost = 0;
            modelUsage = {};
            for (const [model, mu] of Object.entries(resultMsg.modelUsage)) {
              input += mu.inputTokens ?? 0;
              output += mu.outputTokens ?? 0;
              cacheRead += mu.cacheReadInputTokens ?? 0;
              cacheCreation += mu.cacheCreationInputTokens ?? 0;
              cost += mu.costUSD ?? 0;
              modelUsage[model] = {
                inputTokens: mu.inputTokens ?? 0,
                outputTokens: mu.outputTokens ?? 0,
                cacheReadInputTokens: mu.cacheReadInputTokens ?? 0,
                cacheCreationInputTokens: mu.cacheCreationInputTokens ?? 0,
                costUsd: mu.costUSD ?? 0,
                ...(mu.webSearchRequests !== undefined ? { webSearchRequests: mu.webSearchRequests } : {}),
                ...(mu.contextWindow !== undefined ? { contextWindow: mu.contextWindow } : {}),
                ...(mu.maxOutputTokens !== undefined ? { maxOutputTokens: mu.maxOutputTokens } : {}),
              };
            }
            actualModels = Object.keys(modelUsage);
            usage = {
              inputTokens: input,
              outputTokens: output,
              cacheReadInputTokens: cacheRead,
              cacheCreationInputTokens: cacheCreation,
              costUsd: cost,
            };
          }
          totalCostUsd = resultMsg.total_cost_usd;

          // Capture session_id from result if not already set
          if (!sdkSessionId && message.session_id) {
            sdkSessionId = message.session_id;
          }

          // Check for error results
          if (message.subtype !== 'success') {
            // Error subtypes: error_during_execution, error_max_turns, error_max_budget_usd, error_max_structured_output_retries
            const errors = 'errors' in message ? (message.errors) : [];
            const errorMsg = errors.length > 0 ? errors.join('; ') : `Query failed: ${message.subtype}`;
            throw new Error(`SDK query error: ${errorMsg}`);
          }

          break;
        }
      }

      const response = responseChunks.join('');

      // === Cache Efficiency Monitoring ===
      // Ratio of cache_read / total_input indicates how well prompt caching is working.
      // Target: >80% cache_read means good cache hit rate (similar to CLI interactive mode).
      // <50% means most content is being cache-WRITE'd (subprocess cache bust).
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
          sdkSessionId,
          responseLength: response.length,
          numTurns,
          durationMs,
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
            actualModels,
            modelUsage,
          } : {}),
        },
        `SDK query completed (cache efficiency: ${cacheEfficiency ?? 'N/A'}%)`
      );

      const queryResult: QueryResult = {
        response,
        sdkSessionId,
        numTurns,
        durationMs,
        intermediateMessageCount: intermediateCount,
      };
      if (usage) {
        queryResult.usage = usage;
      }
      if (totalCostUsd !== undefined) {
        queryResult.totalCostUsd = totalCostUsd;
      }
      if (actualModels !== undefined) {
        queryResult.actualModels = actualModels;
      }
      if (modelUsage !== undefined) {
        queryResult.modelUsage = modelUsage;
      }
      return queryResult;
    } finally {
      // Clean up active query
      this.activeQueries.delete(sessionId);
    }
  }

  /**
   * Cancel an active query for a session.
   *
   * @param sessionId - ClaudeCab session ID
   */
  cancelQuery(sessionId: string): void {
    const active = this.activeQueries.get(sessionId);
    if (active) {
      logger.debug({ sessionId }, 'Cancelling active query');
      active.abortController.abort();
      active.query.close();
      this.activeQueries.delete(sessionId);
    }
  }

  /**
   * Check if there's an active query for a session.
   *
   * @param sessionId - ClaudeCab session ID
   * @returns True if query is active
   */
  hasActiveQuery(sessionId: string): boolean {
    return this.activeQueries.has(sessionId);
  }

  /**
   * Get the number of active queries.
   */
  get activeQueryCount(): number {
    return this.activeQueries.size;
  }

  /**
   * Dispose the manager and cancel all active queries.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    logger.debug({ activeQueries: this.activeQueries.size }, 'Disposing SDKQueryManager');

    // Cancel all active queries
    for (const [sessionId] of this.activeQueries) {
      this.cancelQuery(sessionId);
    }

    this.disposed = true;
  }
}
