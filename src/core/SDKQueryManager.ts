import { query, type Query, type Options, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { LoadedAgent } from '../types/agent.js';
import type { ToolEvent } from '../adapters/types.js';
import { logger } from '../utils/logger.js';
import { sanitizeBeforeResume } from './JsonlSanitizer.js';

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
 * used in Telegram Bot.
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
    const sdkOptions: Options = {
      cwd: options.cwd,
      settingSources: options.settingSources ?? ['project', 'local'],
      // Only set maxTurns if explicitly provided, otherwise let SDK use its default
      ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
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
    };

    // Log detailed SDK options for debugging
    const systemPromptStr = typeof sdkOptions.systemPrompt === 'string'
      ? sdkOptions.systemPrompt
      : sdkOptions.systemPrompt?.type === 'preset'
        ? `[preset: ${sdkOptions.systemPrompt.preset}+append(${(sdkOptions.systemPrompt.append ?? '').length}chars)]`
        : null;

    logger.info(
      {
        sessionId,
        agentId: agent.id,
        promptPreview: prompt.substring(0, 300) + (prompt.length > 300 ? '...' : ''),
        promptLength: prompt.length,
        hasInjectedContext: prompt.includes('[群組對話紀錄]'),
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
              costUSD?: number;
            }>;
          };

          if (resultMsg.modelUsage) {
            let input = 0, output = 0, cacheRead = 0, cacheCreation = 0, cost = 0;
            for (const mu of Object.values(resultMsg.modelUsage)) {
              input += mu.inputTokens ?? 0;
              output += mu.outputTokens ?? 0;
              cacheRead += mu.cacheReadInputTokens ?? 0;
              cacheCreation += mu.cacheCreationInputTokens ?? 0;
              cost += mu.costUSD ?? 0;
            }
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
              costUsd: usage.costUsd,
            },
            totalCostUsd,
          } : {}),
        },
        'SDK query completed'
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
