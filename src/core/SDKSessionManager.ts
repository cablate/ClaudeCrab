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

interface ManagedSession {
  session: SDKSession;
  sdkSessionId: string;
  createdAt: number;
  lastUsedAt: number;
  messageCount: number;
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

    try {
      await managed.session.send(prompt);
      managed.lastUsedAt = Date.now();
      managed.messageCount++;

      // Process stream
      return await this.processStream(sessionId, managed, options, startTime);
    } catch (error) {
      // Session might have died — clean up and let caller retry with V1 fallback
      logger.warn(
        { sessionId, error: (error as Error).message },
        'V2 session error, cleaning up'
      );
      this.destroySession(sessionId);
      throw error;
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
    const sessionOptions: PatchedSessionOptions = {
      model: agent.config.model ?? 'claude-sonnet-4-20250514',
      cwd: options.cwd, // Agent working directory — critical for JSONL path resolution
      permissionMode: 'default',
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

    // Create or resume session
    let session: SDKSession;
    if (options.resume) {
      session = unstable_v2_resumeSession(
        options.resume,
        sessionOptions as Parameters<typeof unstable_v2_resumeSession>[1]
      );
    } else {
      session = unstable_v2_createSession(
        sessionOptions as Parameters<typeof unstable_v2_createSession>[0]
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
    };

    this.sessions.set(sessionId, managed);

    logger.info(
      { sessionId, sdkSessionId, hasResume: !!options.resume },
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

    for await (const message of managed.session.stream()) {
      // Extract session_id from init
      if (message.type === 'system' && 'subtype' in message) {
        const systemMsg = message as { subtype?: string; session_id?: string };
        if (systemMsg.subtype === 'init' && systemMsg.session_id) {
          managed.sdkSessionId = systemMsg.session_id;
        }
      }

      // Collect assistant text
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
