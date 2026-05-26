/**
 * SDKStreamProcessor — processes the V2 session stream after send().
 *
 * Extracted from SDKSessionManager.ts (processStream method + helpers).
 * Responsible for:
 *   - Stream message iteration and classification
 *   - Sub-agent event detection and lifecycle tracking
 *   - Tool event extraction
 *   - Result/error handling and usage delta computation
 */

import type { QueryUsage, QueryResult, ExecuteQueryOptions, QueryModelUsage } from './SDKQueryManager.js';
import type { ToolEvent } from '../types/message.js';
import type { SubAgentEvent, SubAgentLifecycle } from '../types/subAgent.js';
import type { ManagedSession } from './SDKSessionTypes.js';
import type { RateLimitRepository } from '../persistence/RateLimitRepository.js';
import { logger } from '../utils/logger.js';
import { EventType } from '../utils/events.js';
import { summarizeGovernanceSession } from './governance/telemetry.js';
import { collectContextUsageSnapshot } from './ContextUsageTelemetry.js';
import { analyzeCurrentTurn, getJsonlPathForAgent, type TurnMetrics } from './CacheAnomalyAnalyzer.js';

/** Sentinel used by Promise.race to distinguish a timeout from a real stream message */
const DRAIN_SENTINEL = Symbol('drain-timeout');
const POST_RESULT_DRAIN_QUIET_MS = 1200;
const POST_RESULT_DRAIN_MAX_MS = 8000;
const POST_RESULT_DRAIN_POLL_MS = 250;

/**
 * Direct access to the cached `queryIterator` field on a cQ session instance.
 * Returns null if stream() hasn't been called yet.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCachedQueryIterator(session: ManagedSession['session']): AsyncIterator<any> | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iter = (session as any).queryIterator;
  return iter ?? null;
}

/**
 * Direct access to the internal Query object on a cQ session instance.
 * The Query has interrupt() for graceful cancellation.
 */
export function getSessionQuery(session: ManagedSession['session']): { interrupt(): Promise<void> } | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (session as any).query;
  if (query && typeof query.interrupt === 'function') return query;
  return null;
}

/**
 * Extract assistant text from a stream message.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractAssistantText(msg: any): string {
  if (msg.type !== 'assistant' || !msg.message?.content) return '';
  const parts: string[] = [];
  for (const block of msg.message.content) {
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('');
}

function extractAssistantModel(msg: unknown): string | undefined {
  const message = msg as { type?: unknown; message?: { model?: unknown } };
  if (message.type !== 'assistant') return undefined;
  return typeof message.message?.model === 'string' && message.message.model.length > 0
    ? message.message.model
    : undefined;
}

function extractParentToolUseId(msg: unknown): string | undefined {
  const value = (msg as { parent_tool_use_id?: unknown }).parent_tool_use_id;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function extractTaskToolUseId(msg: unknown): string | undefined {
  const value = (msg as { tool_use_id?: unknown }).tool_use_id;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeModelUsage(
  modelUsage: Record<string, {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    webSearchRequests?: number;
    costUSD?: number;
    contextWindow?: number;
    maxOutputTokens?: number;
  }>,
): Record<string, QueryModelUsage> {
  return Object.fromEntries(
    Object.entries(modelUsage).map(([model, usage]) => [
      model,
      {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadInputTokens: usage.cacheReadInputTokens ?? 0,
        cacheCreationInputTokens: usage.cacheCreationInputTokens ?? 0,
        costUsd: usage.costUSD ?? 0,
        ...(usage.webSearchRequests !== undefined ? { webSearchRequests: usage.webSearchRequests } : {}),
        ...(usage.contextWindow !== undefined ? { contextWindow: usage.contextWindow } : {}),
        ...(usage.maxOutputTokens !== undefined ? { maxOutputTokens: usage.maxOutputTokens } : {}),
      },
    ]),
  );
}

function deltaModelUsage(
  current: Record<string, QueryModelUsage>,
  previous: Record<string, QueryModelUsage> | undefined,
): Record<string, QueryModelUsage> {
  const result: Record<string, QueryModelUsage> = {};
  for (const [model, usage] of Object.entries(current)) {
    const prev = previous?.[model];
    const delta: QueryModelUsage = {
      inputTokens: Math.max(0, usage.inputTokens - (prev?.inputTokens ?? 0)),
      outputTokens: Math.max(0, usage.outputTokens - (prev?.outputTokens ?? 0)),
      cacheReadInputTokens: Math.max(0, usage.cacheReadInputTokens - (prev?.cacheReadInputTokens ?? 0)),
      cacheCreationInputTokens: Math.max(0, usage.cacheCreationInputTokens - (prev?.cacheCreationInputTokens ?? 0)),
      costUsd: Math.max(0, usage.costUsd - (prev?.costUsd ?? 0)),
      ...(usage.webSearchRequests !== undefined
        ? { webSearchRequests: Math.max(0, usage.webSearchRequests - (prev?.webSearchRequests ?? 0)) }
        : {}),
      ...(usage.contextWindow !== undefined ? { contextWindow: usage.contextWindow } : {}),
      ...(usage.maxOutputTokens !== undefined ? { maxOutputTokens: usage.maxOutputTokens } : {}),
    };
    const used =
      delta.inputTokens > 0 ||
      delta.outputTokens > 0 ||
      delta.cacheReadInputTokens > 0 ||
      delta.cacheCreationInputTokens > 0 ||
      delta.costUsd > 0 ||
      (delta.webSearchRequests ?? 0) > 0;
    if (used) result[model] = delta;
  }
  return result;
}

/**
 * Normalize a CLI `system task_*` message into a `SubAgentEvent`, or return null.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractSubAgentEvent(msg: any): SubAgentEvent | null {
  if (msg?.type !== 'system') return null;
  const m = msg as {
    subtype?: string;
    task_id?: string;
    description?: string;
    last_tool_name?: string;
    status?: string;
    summary?: string;
    output_file?: string;
    usage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number };
  };
  if (!m.task_id) return null;

  if (m.subtype === 'task_started') {
    return {
      taskId: m.task_id,
      lifecycle: 'started',
      description: m.description ?? '未命名子代理',
    };
  }
  if (m.subtype === 'task_progress') {
    const event: SubAgentEvent = {
      taskId: m.task_id,
      lifecycle: 'progress',
      description: m.description ?? '',
    };
    if (m.last_tool_name) event.toolName = m.last_tool_name;
    if (m.usage?.total_tokens !== undefined) event.totalTokens = m.usage.total_tokens;
    if (m.usage?.tool_uses !== undefined) event.toolUses = m.usage.tool_uses;
    if (m.usage?.duration_ms !== undefined) event.durationMs = m.usage.duration_ms;
    if (m.summary) event.summary = m.summary;
    return event;
  }
  if (m.subtype === 'task_notification') {
    const lifecycle: SubAgentLifecycle = m.status === 'completed' ? 'completed' : 'failed';
    const event: SubAgentEvent = {
      taskId: m.task_id,
      lifecycle,
      description: m.summary ?? m.description ?? '',
    };
    if (m.summary) event.summary = m.summary;
    if (m.output_file) event.outputFile = m.output_file;
    if (m.usage?.total_tokens !== undefined) event.totalTokens = m.usage.total_tokens;
    if (m.usage?.tool_uses !== undefined) event.toolUses = m.usage.tool_uses;
    if (m.usage?.duration_ms !== undefined) event.durationMs = m.usage.duration_ms;
    return event;
  }
  return null;
}

/**
 * Process stream messages from a V2 session.
 *
 * Mutates `managed` fields: sdkSessionId, lastIntermediateSendPromise, prevUsage.
 * Reads: messageCount, cancelled, isKeepalivePing (via hook closures, not here),
 *        pendingDrainPromise.
 */
export async function processStream(
  sessionId: string,
  managed: ManagedSession,
  options: ExecuteQueryOptions,
  startTime: number,
  updateCacheEfficiency: (sessionId: string, managed: ManagedSession, usage: QueryUsage) => void,
  rateLimitRepository?: RateLimitRepository,
): Promise<QueryResult> {
  const responseChunks: string[] = [];
  let numTurns = 0;
  let durationMs = 0;
  let intermediateCount = 0;
  let usage: QueryUsage | undefined;
  let totalCostUsd: number | undefined;
  let modelUsage: Record<string, QueryModelUsage> | undefined;
  let actualModels: string[] | undefined;
  const toolIdToName = new Map<string, string>();
  const activeSubAgentTaskIds = new Set<string>();
  const subAgentToolUseIdToTaskId = new Map<string, string>();
  const observedSubAgentModels = new Map<string, Set<string>>();
  const getSingleActiveSubAgentTaskId = (): string | undefined => {
    if (activeSubAgentTaskIds.size !== 1) return undefined;
    return activeSubAgentTaskIds.values().next().value;
  };
  const getSubAgentTaskIdForMessage = (msg: unknown): string | undefined => {
    const parentToolUseId = extractParentToolUseId(msg);
    if (parentToolUseId !== undefined) {
      const mappedTaskId = subAgentToolUseIdToTaskId.get(parentToolUseId);
      if (mappedTaskId !== undefined) return mappedTaskId;
    }
    return getSingleActiveSubAgentTaskId();
  };
  const emitObservedSubAgentModel = async (msg: unknown): Promise<void> => {
    if (!options.onSubAgentEvent || activeSubAgentTaskIds.size === 0) return;
    const actualModel = extractAssistantModel(msg);
    if (actualModel === undefined) return;
    const taskId = getSubAgentTaskIdForMessage(msg);
    if (taskId === undefined) return;

    const observedModels = observedSubAgentModels.get(taskId) ?? new Set<string>();
    if (observedModels.has(actualModel)) return;
    observedModels.add(actualModel);
    observedSubAgentModels.set(taskId, observedModels);

    await options.onSubAgentEvent({
      taskId,
      lifecycle: 'progress',
      description: '',
      actualModel,
    });
  };

  let streamMsgIndex = 0;

  const isFirstQuery = managed.messageCount === 1;
  const isFreshResume = isFirstQuery && !!options.resume;
  let streamReady = !isFreshResume;
  let staleRetries = 0;
  const MAX_STALE_RETRIES = 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let streamIterator = (managed.session.stream() as AsyncIterable<any>)[Symbol.asyncIterator]();
  while (true) {
    // Orphan handoff from pre-drain
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let __iterResult: IteratorResult<any>;
    if (managed.pendingDrainPromise) {
      const carry = managed.pendingDrainPromise;
      managed.pendingDrainPromise = undefined;
      __iterResult = await carry;
      logger.info(
        { sessionId, msgIndex: streamMsgIndex, msgType: __iterResult.done ? 'done' : (__iterResult.value as { type?: string })?.type, event_type: 'sdk.predrain_carry_consumed' },
        'Consumed pre-drain orphan promise as first stream message'
      );
    } else {
      __iterResult = await streamIterator.next();
    }
    if (__iterResult.done) break;
    const message = __iterResult.value;

    // Cooperative cancellation
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

    if (message.type === 'system' && 'subtype' in message) {
      const systemMsg = message as {
        subtype?: string;
        session_id?: string;
        hook_event?: string;
        hook_name?: string;
        outcome?: string;
        exit_code?: number;
        stderr?: string;
        attempt?: number;
        max_retries?: number;
        delay_ms?: number;
        status?: number | string;
        memory_paths?: string[];
        error?: string;
      };
      if (systemMsg.subtype === 'init') {
        streamReady = true;
        if (systemMsg.session_id) {
          managed.sdkSessionId = systemMsg.session_id;
        }
      } else if (systemMsg.subtype === 'hook_started') {
        logger.info(
          { sessionId, hookEvent: systemMsg.hook_event, hookName: systemMsg.hook_name, event_type: EventType.SDK_HOOK_STARTED },
          'V2 hook started'
        );
      } else if (systemMsg.subtype === 'hook_progress') {
        logger.info(
          { sessionId, hookEvent: systemMsg.hook_event, hookName: systemMsg.hook_name, event_type: EventType.SDK_HOOK_PROGRESS },
          'V2 hook progress'
        );
      } else if (systemMsg.subtype === 'hook_response') {
        logger.info(
          { sessionId, hookEvent: systemMsg.hook_event, hookName: systemMsg.hook_name, outcome: systemMsg.outcome, exitCode: systemMsg.exit_code, stderr: systemMsg.stderr?.substring(0, 200), event_type: EventType.SDK_HOOK_RESPONSE },
          'V2 hook response'
        );
      } else if (systemMsg.subtype === 'api_retry') {
        logger.warn(
          { sessionId, attempt: systemMsg.attempt, maxRetries: systemMsg.max_retries, delayMs: systemMsg.delay_ms, status: systemMsg.status, rawMessage: systemMsg, event_type: EventType.SDK_API_RETRY },
          'SDK api_retry'
        );
      } else if (systemMsg.subtype === 'memory_recall') {
        logger.debug(
          { sessionId, memoryPaths: systemMsg.memory_paths, event_type: EventType.SDK_MEMORY_RECALL },
          'SDK memory_recall'
        );
      } else if (systemMsg.subtype === 'status') {
        logger.debug(
          { sessionId, status: systemMsg.status, event_type: EventType.SDK_STATUS },
          'SDK status'
        );
      } else if (systemMsg.subtype === 'mirror_error') {
        logger.warn(
          { sessionId, err: systemMsg.error, event_type: EventType.SDK_MIRROR_ERROR },
          'SDK sessionStore mirror_error'
        );
      }
    }

    if (message.type === 'rate_limit_event') {
      const rl = message as { type: 'rate_limit_event'; rate_limit_info?: { status?: string; resetsAt?: number; rateLimitType?: string; utilization?: number; overageStatus?: string; overageDisabledReason?: string; isUsingOverage?: boolean; surpassedThreshold?: number }; [k: string]: unknown };
      const info = rl.rate_limit_info;
      logger.warn(
        { sessionId, event_type: EventType.SDK_RATE_LIMIT, rateLimit: info ?? rl },
        'SDK rate_limit_event'
      );
      if (rateLimitRepository && info) {
        try {
          rateLimitRepository.record({
            sdkSessionId: managed.sdkSessionId,
            rateLimitType: info.rateLimitType ?? 'unknown',
            utilizationPct: info.utilization ?? info.surpassedThreshold ?? 0,
            status: info.status ?? 'unknown',
            ...(info.resetsAt !== undefined ? { resetsAt: info.resetsAt } : {}),
            ...(info.isUsingOverage ? { isUsingOverage: 1 } : {}),
          });
        } catch (err) {
          logger.warn({ sessionId, err }, 'Failed to persist rate_limit_event');
        }
      }
    }

    const fallbackMs = isFreshResume ? 30000 : 3000;
    if (!streamReady && elapsed >= fallbackMs) {
      logger.info({ sessionId, elapsed, isFreshResume }, 'Stream ready via elapsed time fallback');
      streamReady = true;
    }

    if (!streamReady && message.type !== 'system') {
      logger.debug({ sessionId, msgIndex: streamMsgIndex - 1, msgType: message.type, elapsed }, 'Skipping stale replay message');
      continue;
    }

    const messageText = extractAssistantText(message);
    await emitObservedSubAgentModel(message);

    // DIAG: per-assistant-message block type audit + per-turn context tracking
    if (message.type === 'assistant' && message.message?.content) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blockTypes = (message.message.content as any[]).map((b) => b?.type ?? 'unknown');
      const textLen = messageText.length;
      logger.info(
        { sessionId, msgIndex: streamMsgIndex - 1, blockTypes, textLen, event_type: 'sdk.assistant_block_audit' },
        'DIAG assistant blocks'
      );

      // Each assistant message carries per-turn usage from the API.
      // This is the real context size for this turn, not cumulative throughput.
      const turnUsage = (message.message as {
        usage?: {
          input_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number };
        };
      }).usage;
      if (turnUsage) {
        managed.lastTurnContextTokens =
          (turnUsage.input_tokens ?? 0) +
          (turnUsage.cache_read_input_tokens ?? 0) +
          (turnUsage.cache_creation_input_tokens ?? 0);

        if (
          (turnUsage.cache_read_input_tokens ?? 0) > 0 ||
          (turnUsage.cache_creation_input_tokens ?? 0) > 0
        ) {
          // Anthropic prompt-cache TTL is tied to the API request, not when the
          // final result event reaches us. Long turns can run past the 5-minute
          // tier, so schedule keepalive from send time instead of completion.
          managed.lastCacheTouchAt = managed.lastUsedAt;
        }

        // Detect cache TTL tier from API response — update every turn.
        if (turnUsage.cache_creation) {
          const cc = turnUsage.cache_creation;
          let newTTLMs: number | undefined;
          if ((cc.ephemeral_1h_input_tokens ?? 0) > 0) {
            newTTLMs = 3_600_000;
          } else if ((cc.ephemeral_5m_input_tokens ?? 0) > 0) {
            newTTLMs = 300_000;
          }
          if (newTTLMs !== undefined) {
            if (managed.detectedCacheTTLMs !== undefined && managed.detectedCacheTTLMs !== newTTLMs) {
              logger.warn(
                { sessionId, prevTTLMs: managed.detectedCacheTTLMs, newTTLMs, event_type: 'sdk.cache_ttl_changed' },
                `Cache TTL tier changed: ${managed.detectedCacheTTLMs / 60000}min → ${newTTLMs / 60000}min`
              );
            } else if (managed.detectedCacheTTLMs === undefined) {
              logger.info(
                { sessionId, detectedCacheTTLMs: newTTLMs, event_type: 'sdk.cache_ttl_detected' },
                `Cache TTL tier detected: ${newTTLMs / 60000} min`
              );
            }
            managed.detectedCacheTTLMs = newTTLMs;
          }
        }

        // Per-turn cache anomaly check — main session turns only.
        // Subagent turns (different model) are logged but excluded from anomaly thresholds.
        const turnModel = extractAssistantModel(message);
        const isSubagentTurn = turnModel !== undefined && turnModel !== managed.model;
        if (isSubagentTurn && turnUsage.cache_creation_input_tokens !== undefined) {
          logger.info(
            {
              sessionId,
              sdkSessionId: managed.sdkSessionId,
              turnModel,
              cacheCreation: turnUsage.cache_creation_input_tokens,
              cacheRead: turnUsage.cache_read_input_tokens ?? 0,
              event_type: 'sdk.subagent_turn_cache',
            },
            `Subagent turn cache: model=${turnModel} create=${turnUsage.cache_creation_input_tokens} read=${turnUsage.cache_read_input_tokens ?? 0}`
          );
        }
        if (!isSubagentTurn && turnUsage.cache_creation_input_tokens !== undefined && options.resume !== undefined) {
          const jsonlPath = managed.sdkSessionId
            ? getJsonlPathForAgent(managed.sdkSessionId, managed.cwd)
            : '';
          const turnAnomaly = analyzeCurrentTurn(
            {
              input_tokens: turnUsage.input_tokens ?? 0,
              cache_read_input_tokens: turnUsage.cache_read_input_tokens ?? 0,
              cache_creation_input_tokens: turnUsage.cache_creation_input_tokens ?? 0,
              output_tokens: 0,
            },
            jsonlPath,
            managed.detectedCacheTTLMs,
          );
          if (turnAnomaly !== null) {
            logger.warn(
              {
                sessionId,
                sdkSessionId: managed.sdkSessionId,
                agentId: managed.agentId,
                msgIndex: streamMsgIndex,
                anomaly: turnAnomaly.anomaly,
                cause: turnAnomaly.cause,
                causeDetail: turnAnomaly.causeDetail,
                causeLine: turnAnomaly.causeLine,
                cacheRead: turnAnomaly.cacheRead,
                cacheCreation: turnAnomaly.cacheCreation,
                hitPct: turnAnomaly.hitPct,
                event_type: EventType.CACHE_ANOMALY_PER_TURN,
              },
              `Per-turn cache anomaly: ${turnAnomaly.anomaly} (create=${turnAnomaly.cacheCreation} hit=${turnAnomaly.hitPct}% cause=${turnAnomaly.cause})`
            );
          }
        }
      }
    }

    if (messageText.length > 0) {
      if (options.onIntermediateMessage) {
        const sendPromise = Promise.resolve(options.onIntermediateMessage(messageText));
        managed.lastIntermediateSendPromise = sendPromise;
        await sendPromise;
        intermediateCount++;
      } else {
        responseChunks.push(messageText);
      }
    }

    // Sub-agent lifecycle events
    const subAgentEvent = extractSubAgentEvent(message);
    if (subAgentEvent && options.onSubAgentEvent) {
      try {
        await options.onSubAgentEvent(subAgentEvent);
      } catch (err) {
        logger.warn(
          { sessionId, taskId: subAgentEvent.taskId, lifecycle: subAgentEvent.lifecycle, err: err instanceof Error ? err.message : String(err) },
          'onSubAgentEvent callback threw, continuing stream'
        );
      }
    }
    if (subAgentEvent?.lifecycle === 'started') {
      activeSubAgentTaskIds.add(subAgentEvent.taskId);
      const toolUseId = extractTaskToolUseId(message);
      if (toolUseId !== undefined) {
        subAgentToolUseIdToTaskId.set(toolUseId, subAgentEvent.taskId);
      }
    } else if (subAgentEvent?.lifecycle === 'completed' || subAgentEvent?.lifecycle === 'failed') {
      activeSubAgentTaskIds.delete(subAgentEvent.taskId);
    }

    // Tool events
    if (options.onToolEvent) {
      const toolScope = activeSubAgentTaskIds.size > 0 ? 'subagent' : 'main';
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            toolIdToName.set(block.id, block.name);
            const subAgentTaskId = toolScope === 'subagent' ? getSingleActiveSubAgentTaskId() : undefined;
            if (subAgentTaskId !== undefined && options.onSubAgentEvent) {
              await options.onSubAgentEvent({
                taskId: subAgentTaskId,
                lifecycle: 'progress',
                description: '',
                toolName: block.name,
                eventLabel: `${block.name} start`,
              });
            }
            await options.onToolEvent({
              type: 'tool_use',
              toolName: block.name,
              timestamp: Date.now(),
              scope: toolScope,
            });
          } else if (
            block.type === 'thinking' &&
            typeof block.thinking === 'string' &&
            block.thinking.length > 0
          ) {
            await options.onToolEvent({
              type: 'thinking',
              toolName: 'thinking',
              summary: block.thinking,
              timestamp: Date.now(),
              scope: toolScope,
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
            const subAgentTaskId = toolScope === 'subagent' ? getSingleActiveSubAgentTaskId() : undefined;
            if (subAgentTaskId !== undefined && options.onSubAgentEvent && toolName !== 'tool') {
              await options.onSubAgentEvent({
                taskId: subAgentTaskId,
                lifecycle: 'progress',
                description: '',
                toolName,
                eventLabel: `${toolName} done`,
              });
            }
            const toolEvent: ToolEvent = {
              type: 'tool_result',
              toolName,
              timestamp: Date.now(),
              scope: toolScope,
            };
            if (typeof toolResultBlock.content === 'string') {
              toolEvent.summary = toolResultBlock.content.substring(0, 100);
            }
            await options.onToolEvent(toolEvent);
          }
        }
      }
    }

    // Result message
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
          webSearchRequests?: number;
          costUSD?: number;
          contextWindow?: number;
          maxOutputTokens?: number;
        }>;
      };

      if (resultMsg.modelUsage) {
        const currentModelUsage = normalizeModelUsage(resultMsg.modelUsage);
        modelUsage = deltaModelUsage(currentModelUsage, managed.prevModelUsage);
        actualModels = Object.keys(modelUsage);
        let cumInput = 0, cumOutput = 0, cumCacheRead = 0, cumCacheCreation = 0, cumCost = 0;
        for (const mu of Object.values(currentModelUsage)) {
          cumInput += mu.inputTokens ?? 0;
          cumOutput += mu.outputTokens ?? 0;
          cumCacheRead += mu.cacheReadInputTokens ?? 0;
          cumCacheCreation += mu.cacheCreationInputTokens ?? 0;
          cumCost += mu.costUsd ?? 0;
        }

        const prev = managed.prevUsage;
        const prevTotalCost = prev.totalCostUsd;
        const cumTotalCostVal = resultMsg.total_cost_usd ?? 0;

        usage = {
          inputTokens: Math.max(0, cumInput - prev.inputTokens),
          outputTokens: Math.max(0, cumOutput - prev.outputTokens),
          cacheReadInputTokens: Math.max(0, cumCacheRead - prev.cacheReadInputTokens),
          cacheCreationInputTokens: Math.max(0, cumCacheCreation - prev.cacheCreationInputTokens),
          costUsd: Math.max(0, cumCost - prev.costUsd),
        };
        totalCostUsd = Math.max(0, cumTotalCostVal - prevTotalCost);

        // lastTurnContextTokens is updated per-turn in the assistant message
        // handler above (from message.message.usage). The result block only
        // needs to capture the model's context window limit for percentage calc.
        // Capture model's context window size for percentage calculation
        if (managed.contextWindowSize === undefined) {
          for (const mu of Object.values(resultMsg.modelUsage)) {
            if (mu.contextWindow && mu.contextWindow > 0) {
              managed.contextWindowSize = mu.contextWindow;
              break;
            }
          }
        }

        managed.prevUsage = {
          inputTokens: cumInput,
          outputTokens: cumOutput,
          cacheReadInputTokens: cumCacheRead,
          cacheCreationInputTokens: cumCacheCreation,
          costUsd: cumCost,
          totalCostUsd: cumTotalCostVal,
        };
        managed.prevModelUsage = currentModelUsage;
      } else {
        totalCostUsd = resultMsg.total_cost_usd;
      }

      if (message.subtype !== 'success') {
        const errors = 'errors' in message ? (message.errors as string[]) : [];
        const errorMsg = errors.length > 0 ? errors.join('; ') : `Query failed: ${message.subtype}`;
        throw new Error(`SDK V2 session error: ${errorMsg}`);
      }

      // Stale-residue retry
      const isStaleResidue =
        numTurns === 0 &&
        responseChunks.length === 0 &&
        intermediateCount === 0 &&
        elapsed < 1000;
      if (isStaleResidue && staleRetries < MAX_STALE_RETRIES) {
        staleRetries++;
        logger.warn(
          { sessionId, elapsed, msgIndex: streamMsgIndex - 1, sessionMessageCount: managed.messageCount, staleRetries },
          'Stale residual result reached main loop (pre-drain missed it) — retrying with fresh stream iterator'
        );
        numTurns = 0;
        durationMs = 0;
        usage = undefined;
        totalCostUsd = undefined;
        modelUsage = undefined;
        actualModels = undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        streamIterator = (managed.session.stream() as AsyncIterable<any>)[Symbol.asyncIterator]();
        continue;
      }

      break;
    }
  }

  // Post-result drain
  {
    const queryIter = getCachedQueryIterator(managed.session);
    const drainDeadline = Date.now() + POST_RESULT_DRAIN_MAX_MS;
    let quietDeadline = Date.now() + POST_RESULT_DRAIN_QUIET_MS;
    let drained = 0;
    let routedSubAgentEvents = 0;
    const drainedTypes: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pending: Promise<IteratorResult<any>> | undefined = queryIter?.next();

    while (queryIter && pending && Date.now() < drainDeadline) {
      const remaining = drainDeadline - Date.now();
      const timeoutMs = Math.max(1, Math.min(POST_RESULT_DRAIN_POLL_MS, quietDeadline - Date.now(), remaining));

      const raceResult = await Promise.race([
        pending,
        new Promise<typeof DRAIN_SENTINEL>(resolve =>
          setTimeout(() => resolve(DRAIN_SENTINEL), timeoutMs)
        ),
      ]);

      if (raceResult === DRAIN_SENTINEL) {
        if (Date.now() >= quietDeadline) {
          managed.pendingDrainPromise = pending;
          logger.debug(
            { sessionId, drained, routedSubAgentEvents, drainedTypes },
            'Post-result drain: quiet window reached, carrying pending iterator promise'
          );
          pending = undefined;
          break;
        }
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { done, value: drainMsg } = raceResult as IteratorResult<any>;
      pending = undefined;
      if (done) break;

      drained++;
      const drainMsgType = (drainMsg as { type?: string })?.type ?? 'unknown';
      if (drainedTypes.length < 12) drainedTypes.push(drainMsgType);
      quietDeadline = Date.now() + POST_RESULT_DRAIN_QUIET_MS;

      await emitObservedSubAgentModel(drainMsg);
      const drainText = extractAssistantText(drainMsg);
      if (drainText.length > 0) {
        if (options.onIntermediateMessage) {
          await options.onIntermediateMessage(drainText);
          intermediateCount++;
        } else {
          responseChunks.push(drainText);
        }
      }

      const drainSubAgentEvent = extractSubAgentEvent(drainMsg);
      if (drainSubAgentEvent && options.onSubAgentEvent) {
        try {
          await options.onSubAgentEvent(drainSubAgentEvent);
          routedSubAgentEvents++;
        } catch (err) {
          logger.warn(
            { sessionId, taskId: drainSubAgentEvent.taskId, lifecycle: drainSubAgentEvent.lifecycle, err: err instanceof Error ? err.message : String(err) },
            'onSubAgentEvent (drain) callback threw, continuing'
          );
        }
      }

      logger.debug(
        { sessionId, msgType: drainMsg.type, msgSubtype: 'subtype' in drainMsg ? (drainMsg as { subtype?: string }).subtype : undefined },
        'Post-result drain: consumed trailing message from queryIterator'
      );
      pending = queryIter.next();
    }

    if (pending && Date.now() >= drainDeadline) {
      managed.pendingDrainPromise = pending;
      logger.warn(
        { sessionId, drained, routedSubAgentEvents, drainedTypes },
        'Post-result drain: max budget reached, carrying pending iterator promise'
      );
    } else if (drained > 0) {
      logger.info(
        { sessionId, drained, routedSubAgentEvents, drainedTypes },
        'Post-result drain: consumed trailing messages'
      );
    }
  }

  const response = responseChunks.join('');
  const contextUsage = await collectContextUsageSnapshot(sessionId, managed.session);

  // Cache efficiency monitoring
  let cacheEfficiency: number | undefined;
  if (usage) {
    const totalInput = (usage.inputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0);
    cacheEfficiency = totalInput > 0
      ? Math.round(((usage.cacheReadInputTokens ?? 0) / totalInput) * 100)
      : 0;
    updateCacheEfficiency(sessionId, managed, usage);
  }

  logger.info(
    {
      event_type: EventType.AGENT_QUERY_COMPLETE,
      sessionId,
      sdkSessionId: managed.sdkSessionId,
      responseLength: response.length,
      numTurns,
      wallClockMs: Date.now() - startTime,
      sessionMessageCount: managed.messageCount,
      ...(usage ? {
        'gen_ai.system': 'anthropic',
        'gen_ai.usage.input_tokens': usage.inputTokens,
        'gen_ai.usage.output_tokens': usage.outputTokens,
        'gen_ai.usage.cache_read_tokens': usage.cacheReadInputTokens,
        'gen_ai.usage.cache_creation_tokens': usage.cacheCreationInputTokens,
        'gen_ai.usage.total_tokens':
          usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens,
        'gen_ai.usage.cost_usd': usage.costUsd,
        'gen_ai.cache_efficiency_pct': cacheEfficiency,
        total_cost_usd: totalCostUsd,
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
      ...(contextUsage ? {
        contextUsage: {
          totalTokens: contextUsage.totalTokens,
          maxTokens: contextUsage.maxTokens,
          percentage: contextUsage.percentage,
          model: contextUsage.model,
          topCategories: contextUsage.categories.slice(0, 5),
          topMcpTools: contextUsage.mcpTools.slice(0, 5),
          topSystemPromptSections: contextUsage.systemPromptSections?.slice(0, 5),
        },
      } : {}),
    },
    `V2 session query completed (cache efficiency: ${cacheEfficiency ?? 'N/A'}%, msg #${managed.messageCount})`
  );

  // Update lastQueryAt on normal completion (not keepalive pings — those use
  // their own for-await loop in SDKKeepaliveManager and never call processStream).
  managed.lastQueryAt = Date.now();
  // Reset cacheTTL guard flag so it can fire again on the next idle gap.
  managed.guardShownForCacheTTL = false;

  const queryResult: QueryResult = {
    response,
    sdkSessionId: managed.sdkSessionId,
    numTurns,
    durationMs,
    intermediateMessageCount: intermediateCount,
    isUsageDelta: true,
  };
  if (usage) queryResult.usage = usage;
  if (managed.lastTurnContextTokens !== undefined) queryResult.contextTokens = managed.lastTurnContextTokens;
  if (totalCostUsd !== undefined) queryResult.totalCostUsd = totalCostUsd;
  if (actualModels !== undefined) queryResult.actualModels = actualModels;
  if (modelUsage !== undefined) queryResult.modelUsage = modelUsage;
  queryResult.mainModel = managed.model;
  if (contextUsage !== undefined) queryResult.contextUsage = contextUsage;
  queryResult.governanceSummary = summarizeGovernanceSession(managed.governance);

  return queryResult;
}

// ============================================================
// Drain utilities — process residual iterator messages between queries
// ============================================================

interface DrainResult {
  drained: number;
  routed: number;
  drainedTypes: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pending?: Promise<IteratorResult<any>>;
}

async function drainIterator(
  sessionId: string,
  managed: ManagedSession,
  opts: { perNextTimeoutMs: number; totalBudgetMs: number },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialPending?: Promise<IteratorResult<any>> | null
): Promise<DrainResult> {
  const queryIter = getCachedQueryIterator(managed.session);
  if (!queryIter) return { drained: 0, routed: 0, drainedTypes: [] };

  const deadline = Date.now() + opts.totalBudgetMs;
  let drained = 0;
  let routed = 0;
  const drainedTypes: string[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pending: Promise<IteratorResult<any>> | null = initialPending ?? queryIter.next();

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const timeoutMs = Math.min(opts.perNextTimeoutMs, remaining);
    const TIMEOUT = Symbol('drain-iter-timeout');
    const raceResult = await Promise.race([
      pending,
      new Promise<typeof TIMEOUT>(resolve =>
        setTimeout(() => resolve(TIMEOUT), timeoutMs)
      ),
    ]);
    if (raceResult === TIMEOUT) return { drained, routed, drainedTypes, pending };
    if (raceResult.done) { pending = null; break; }
    drained++;
    const msgType = (raceResult.value as { type?: string })?.type ?? 'unknown';
    if (drainedTypes.length < 10) drainedTypes.push(msgType);

    const subAgentEvent = extractSubAgentEvent(raceResult.value);
    if (subAgentEvent && managed.subAgentManager) {
      try {
        await managed.subAgentManager.handle(subAgentEvent);
        routed++;
      } catch (err) {
        logger.warn(
          {
            sessionId,
            taskId: subAgentEvent.taskId,
            lifecycle: subAgentEvent.lifecycle,
            err: err instanceof Error ? err.message : String(err),
          },
          'drain: subAgentManager.handle threw, continuing'
        );
      }
    }

    if (Date.now() >= deadline) { pending = null; break; }
    pending = queryIter.next();
  }

  return pending
    ? { drained, routed, drainedTypes, pending }
    : { drained, routed, drainedTypes };
}

/**
 * Pre-drain residual messages from the cached queryIterator before starting a new query.
 */
export async function preDrainResidualMessages(
  sessionId: string,
  managed: ManagedSession
): Promise<void> {
  if (managed.messageCount === 0) return;

  const initialPending = managed.pendingDrainPromise ?? undefined;
  managed.pendingDrainPromise = undefined;

  const { drained, routed, drainedTypes, pending } = await drainIterator(
    sessionId, managed,
    { perNextTimeoutMs: 100, totalBudgetMs: 1000 },
    initialPending
  );
  managed.pendingDrainPromise = pending;

  if (drained > 0) {
    logger.warn(
      { sessionId, sessionMessageCount: managed.messageCount, drained, drainedTypes, routedSubAgentEvents: routed, pending: pending !== undefined },
      'Pre-drain: processed residual messages from previous query buffer'
    );
  } else if (pending !== undefined) {
    logger.debug(
      { sessionId, sessionMessageCount: managed.messageCount },
      'Pre-drain: no residual message yet, preserving pending iterator promise'
    );
  }

  if (managed.subAgentManager) {
    managed.subAgentManager.cleanupStale();
  }
}

/**
 * On-demand drain: classify and route sub-agent updates from the iterator.
 * Called by /sync slash command.
 */
export async function drainSubAgentUpdates(
  sessionId: string,
  managed: ManagedSession
): Promise<{ routed: number; drained: number; active: number }> {
  const { drained, routed, pending } = await drainIterator(
    sessionId, managed,
    { perNextTimeoutMs: 100, totalBudgetMs: 1500 }
  );
  managed.pendingDrainPromise = pending;

  logger.info(
    { sessionId, drained, routed, pending: pending !== undefined, activeAfter: managed.subAgentManager?.activeCount() ?? 0 },
    'drainSubAgentUpdates completed'
  );

  return {
    routed,
    drained,
    active: managed.subAgentManager?.activeCount() ?? 0,
  };
}
