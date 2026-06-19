/**
 * SDKStreamProcessor: processes the V2 session stream after send().
 *
 * Extracted from SDKSessionManager.ts (processStream method + helpers).
 * Responsible for:
 *   - Stream message iteration and classification
 *   - Sub-agent event detection and lifecycle tracking
 *   - Tool event extraction
 *   - Result/error handling and usage delta computation
 */

import type { SDKMessage } from '../../types/sdk.js';
import type { QueryUsage, QueryResult, ExecuteQueryOptions, QueryModelUsage } from './types.js';
import { extractAssistantText } from './StreamHelpers.js';
import {
  emitToolEvents,
  handleAssistantUsageMessage,
  handleRateLimitEvent,
  handleResultMessage,
  handleSystemMessage,
  type PerTurnUsageSample,
} from './SDKStreamEventHandlers.js';
import { drainPostResultMessages } from './SDKStreamDrain.js';
import type { ManagedSession } from '../session/SDKSessionTypes.js';
import type { RateLimitRepository } from '../../persistence/RateLimitRepository.js';
import { logger } from '../../utils/logger.js';
import { EventType } from '../../utils/events.js';

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
  // Collect per-turn usage for deferred cache anomaly analysis (read JSONL once instead of N times)
  const perTurnUsage: PerTurnUsageSample[] = [];

  let streamMsgIndex = 0;

  const isFirstQuery = managed.messageCount === 1;
  const isFreshResume = isFirstQuery && !!options.resume;
  let streamReady = !isFreshResume;
  let staleRetries = 0;
  const MAX_STALE_RETRIES = 1;

  let streamIterator: AsyncIterator<SDKMessage> = (managed.session.stream() as AsyncIterable<SDKMessage>)[Symbol.asyncIterator]();
  while (true) {
    // Orphan handoff from pre-drain
    let __iterResult: IteratorResult<SDKMessage>;
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
      logger.info({ sessionId }, 'Query cancelled by user; breaking stream');
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

    if (handleSystemMessage(sessionId, managed, message)) streamReady = true;
    handleRateLimitEvent(sessionId, managed, message, rateLimitRepository);

    const fallbackMs = isFreshResume ? 15000 : 3000;
    if (!streamReady && message.type === 'assistant') {
      // First assistant message after resume is real content, not replay.
      // Use it to become ready even if `init` system message was lost.
      logger.info({ sessionId, msgIndex: streamMsgIndex - 1, elapsed }, 'streamReady triggered by assistant message');
      streamReady = true;
    }
    if (!streamReady && elapsed >= fallbackMs) {
      logger.info({ sessionId, elapsed, isFreshResume }, 'Stream ready via elapsed time fallback');
      streamReady = true;
    }

    if (!streamReady && message.type !== 'system') {
      logger.debug({ sessionId, msgIndex: streamMsgIndex - 1, msgType: message.type, elapsed }, 'Skipping stale replay message');
      continue;
    }

    const messageText = extractAssistantText(message);

    handleAssistantUsageMessage({
      sessionId,
      managed,
      message,
      messageText,
      msgIndex: streamMsgIndex - 1,
      resume: options.resume,
      perTurnUsage,
    });

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

    await emitToolEvents(message, toolIdToName, options.onToolEvent);

    // Result message
    if (message.type === 'result') {
      const resultState = handleResultMessage(message, managed);
      if (resultState === null) {
        throw new Error('SDK stream result message could not be handled');
      }
      numTurns = resultState.numTurns;
      durationMs = resultState.durationMs;
      usage = resultState.usage;
      totalCostUsd = resultState.totalCostUsd;
      modelUsage = resultState.modelUsage;
      actualModels = resultState.actualModels;

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
          'Stale residual result reached main loop (pre-drain missed it); retrying with fresh stream iterator'
        );
        numTurns = 0;
        durationMs = 0;
        usage = undefined;
        totalCostUsd = undefined;
        modelUsage = undefined;
        actualModels = undefined;
        streamIterator = (managed.session.stream() as AsyncIterable<SDKMessage>)[Symbol.asyncIterator]();
        continue;
      }

      break;
    }
  }

  await drainPostResultMessages({
    sessionId,
    managed,
    options,
    responseChunks,
    incrementIntermediateCount: () => { intermediateCount++; },
  });

  const response = responseChunks.join('');

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
    },
    `V2 session query completed (cache efficiency: ${cacheEfficiency ?? 'N/A'}%, msg #${managed.messageCount})`
  );

  // Update lastQueryAt on normal completion (not keepalive pings; those use
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
  };
  if (usage) queryResult.usage = usage;
  if (managed.lastTurnContextTokens !== undefined) queryResult.contextTokens = managed.lastTurnContextTokens;
  if (totalCostUsd !== undefined) queryResult.totalCostUsd = totalCostUsd;
  if (actualModels !== undefined) queryResult.actualModels = actualModels;
  if (modelUsage !== undefined) queryResult.modelUsage = modelUsage;
  queryResult.mainModel = managed.model;

  return queryResult;
}
