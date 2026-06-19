/**
 * SDK stream event side-effect handlers.
 *
 * SDKStreamProcessor owns stream iteration; this module owns per-message
 * interpretation and the ManagedSession mutations caused by those events.
 */

import type { SDKMessage } from '../../types/sdk.js';
import type { ToolEvent } from '../../types/message.js';
import type { RateLimitRepository } from '../../persistence/RateLimitRepository.js';
import type { ManagedSession } from '../session/SDKSessionTypes.js';
import type { QueryModelUsage, QueryUsage } from './types.js';
import {
  deltaModelUsage,
  extractAssistantModel,
  extractBaseModel,
  normalizeModelUsage,
} from './StreamHelpers.js';
import { logger } from '../../utils/logger.js';
import { EventType } from '../../utils/events.js';

export interface PerTurnUsageSample {
  msgIndex: number;
  input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface ResultEventState {
  numTurns: number;
  durationMs: number;
  usage?: QueryUsage;
  totalCostUsd?: number;
  modelUsage?: Record<string, QueryModelUsage>;
  actualModels?: string[];
}

type SystemStreamMessage = SDKMessage & {
  type: 'system';
  subtype?: string;
  session_id?: string;
  hook_event?: unknown;
  hook_name?: unknown;
  outcome?: unknown;
  exit_code?: unknown;
  stderr?: string;
  attempt?: unknown;
  max_retries?: unknown;
  delay_ms?: unknown;
  status?: unknown;
  memory_paths?: unknown;
  error?: unknown;
};

type RateLimitStreamMessage = SDKMessage & {
  type: 'rate_limit_event';
  rate_limit_info?: {
    status?: string;
    resetsAt?: number;
    rateLimitType?: string;
    utilization?: number;
    overageStatus?: string;
    overageDisabledReason?: string;
    isUsingOverage?: boolean;
    surpassedThreshold?: number;
  };
  [key: string]: unknown;
};

type AssistantTurnUsage = {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_1h_input_tokens?: number;
    ephemeral_5m_input_tokens?: number;
  };
};

type ResultMessageWithUsage = SDKMessage & {
  type: 'result';
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

export function handleSystemMessage(
  sessionId: string,
  managed: ManagedSession,
  message: SDKMessage,
): boolean {
  if (message.type !== 'system' || !('subtype' in message)) return false;

  const systemMsg = message as SystemStreamMessage;
  if (systemMsg.subtype === 'init') {
    if (typeof systemMsg.session_id === 'string' && systemMsg.session_id.length > 0) {
      managed.sdkSessionId = systemMsg.session_id;
    }
    return true;
  }

  if (systemMsg.subtype === 'hook_started') {
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

  return false;
}

export function handleRateLimitEvent(
  sessionId: string,
  managed: ManagedSession,
  message: SDKMessage,
  rateLimitRepository?: RateLimitRepository,
): void {
  if (message.type !== 'rate_limit_event') return;

  const rateLimitMessage = message as RateLimitStreamMessage;
  const info = rateLimitMessage.rate_limit_info;
  logger.warn(
    { sessionId, event_type: EventType.SDK_RATE_LIMIT, rateLimit: info ?? rateLimitMessage },
    'SDK rate_limit_event'
  );

  if (!rateLimitRepository || !info) return;

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

export function handleAssistantUsageMessage(params: {
  sessionId: string;
  managed: ManagedSession;
  message: SDKMessage;
  messageText: string;
  msgIndex: number;
  resume?: string | undefined;
  perTurnUsage: PerTurnUsageSample[];
}): void {
  const { sessionId, managed, message, messageText, msgIndex, resume, perTurnUsage } = params;
  if (message.type !== 'assistant' || !message.message?.content) return;

  const blockTypes = message.message.content.map((block) => block?.type ?? 'unknown');
  logger.info(
    { sessionId, msgIndex, blockTypes, textLen: messageText.length, event_type: 'sdk.assistant_block_audit' },
    'DIAG assistant blocks'
  );

  const turnUsage = (message.message as { usage?: AssistantTurnUsage }).usage;
  if (!turnUsage) return;

  managed.lastTurnContextTokens =
    (turnUsage.input_tokens ?? 0) +
    (turnUsage.cache_read_input_tokens ?? 0) +
    (turnUsage.cache_creation_input_tokens ?? 0);

  if (
    (turnUsage.cache_read_input_tokens ?? 0) > 0 ||
    (turnUsage.cache_creation_input_tokens ?? 0) > 0
  ) {
    // Anthropic prompt-cache TTL is tied to the API request, not when the final
    // result event reaches us. Long turns can run past the 5-minute tier.
    managed.lastCacheTouchAt = managed.lastUsedAt;
  }

  if (turnUsage.cache_creation) {
    updateDetectedCacheTtl(sessionId, managed, turnUsage.cache_creation);
  }

  const turnModel = extractAssistantModel(message);
  const isSubagentTurn = turnModel !== undefined && turnModel !== managed.model
    && extractBaseModel(turnModel) !== extractBaseModel(managed.model ?? '');

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

  if (!isSubagentTurn && turnUsage.cache_creation_input_tokens !== undefined && resume !== undefined) {
    perTurnUsage.push({
      msgIndex,
      input_tokens: turnUsage.input_tokens ?? 0,
      cache_read_input_tokens: turnUsage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: turnUsage.cache_creation_input_tokens ?? 0,
    });
  }
}

export async function emitToolEvents(
  message: SDKMessage,
  toolIdToName: Map<string, string>,
  onToolEvent?: (event: ToolEvent) => void | Promise<void>,
): Promise<void> {
  if (!onToolEvent) return;

  const toolScope = 'main' as const;
  if (message.type === 'assistant' && message.message?.content) {
    for (const block of message.message.content) {
      if (block.type === 'tool_use') {
        toolIdToName.set(block.id, block.name);
        await onToolEvent({
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
        await onToolEvent({
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
        const toolEvent: ToolEvent = {
          type: 'tool_result',
          toolName,
          timestamp: Date.now(),
          scope: toolScope,
        };
        if (typeof toolResultBlock.content === 'string') {
          toolEvent.summary = toolResultBlock.content.substring(0, 100);
        }
        await onToolEvent(toolEvent);
      }
    }
  }
}

export function handleResultMessage(
  message: SDKMessage,
  managed: ManagedSession,
): ResultEventState | null {
  if (message.type !== 'result') return null;

  const numTurns = message.num_turns ?? 0;
  const durationMs = message.duration_ms ?? 0;
  const resultMsg = message as ResultMessageWithUsage;
  const state: ResultEventState = { numTurns, durationMs };

  if (resultMsg.modelUsage) {
    const currentModelUsage = normalizeModelUsage(resultMsg.modelUsage);
    const modelUsage = deltaModelUsage(currentModelUsage, managed.prevModelUsage);
    const actualModels = Object.keys(modelUsage);
    let cumInput = 0;
    let cumOutput = 0;
    let cumCacheRead = 0;
    let cumCacheCreation = 0;
    let cumCost = 0;

    for (const model of Object.values(currentModelUsage)) {
      cumInput += model.inputTokens ?? 0;
      cumOutput += model.outputTokens ?? 0;
      cumCacheRead += model.cacheReadInputTokens ?? 0;
      cumCacheCreation += model.cacheCreationInputTokens ?? 0;
      cumCost += model.costUsd ?? 0;
    }

    const prev = managed.prevUsage;
    const cumTotalCostVal = resultMsg.total_cost_usd ?? 0;
    state.usage = {
      inputTokens: Math.max(0, cumInput - prev.inputTokens),
      outputTokens: Math.max(0, cumOutput - prev.outputTokens),
      cacheReadInputTokens: Math.max(0, cumCacheRead - prev.cacheReadInputTokens),
      cacheCreationInputTokens: Math.max(0, cumCacheCreation - prev.cacheCreationInputTokens),
      costUsd: Math.max(0, cumCost - prev.costUsd),
    };
    state.totalCostUsd = Math.max(0, cumTotalCostVal - prev.totalCostUsd);
    state.modelUsage = modelUsage;
    state.actualModels = actualModels;

    if (managed.contextWindowSize === undefined) {
      for (const model of Object.values(resultMsg.modelUsage)) {
        if (model.contextWindow && model.contextWindow > 0) {
          managed.contextWindowSize = model.contextWindow;
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
    state.totalCostUsd = resultMsg.total_cost_usd;
  }

  if (message.subtype !== 'success') {
    const errors = 'errors' in message ? (message.errors as string[]) : [];
    const errorMsg = errors.length > 0 ? errors.join('; ') : `Query failed: ${message.subtype}`;
    throw new Error(`SDK V2 session error: ${errorMsg}`);
  }

  return state;
}

function updateDetectedCacheTtl(
  sessionId: string,
  managed: ManagedSession,
  cacheCreation: NonNullable<AssistantTurnUsage['cache_creation']>,
): void {
  let newTTLMs: number | undefined;
  if ((cacheCreation.ephemeral_1h_input_tokens ?? 0) > 0) {
    newTTLMs = 3_600_000;
  } else if ((cacheCreation.ephemeral_5m_input_tokens ?? 0) > 0) {
    newTTLMs = 300_000;
  }
  if (newTTLMs === undefined) return;

  if (managed.detectedCacheTTLMs !== undefined && managed.detectedCacheTTLMs !== newTTLMs) {
    logger.warn(
      { sessionId, prevTTLMs: managed.detectedCacheTTLMs, newTTLMs, event_type: 'sdk.cache_ttl_changed' },
      `Cache TTL tier changed: ${managed.detectedCacheTTLMs / 60000}min -> ${newTTLMs / 60000}min`
    );
  } else if (managed.detectedCacheTTLMs === undefined) {
    logger.info(
      { sessionId, detectedCacheTTLMs: newTTLMs, event_type: 'sdk.cache_ttl_detected' },
      `Cache TTL tier detected: ${newTTLMs / 60000} min`
    );
  }
  managed.detectedCacheTTLMs = newTTLMs;
}
