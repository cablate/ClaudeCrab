import type { IConversationRepository } from '../../persistence/types.js';
import { buildDiscordChannelUrl, buildDiscordMessageUrl } from '../../types/runtimeContext.js';
import { EventType } from '../../utils/events.js';
import { logger } from '../../utils/logger.js';
import { diagnoseQueryUsage, type UsageAnomalyReport } from '../keepalive/UsageAnomalyDiagnostics.js';
import { getJsonlPath } from '../keepalive/SDKTranscriptDiagnostics.js';
import type { SDKSessionManager } from '../session/SDKSessionManager.js';
import type { QueryExecuteOptions } from './QueryExecutor.js';
import type { QueryResult } from './types.js';

const log = logger.child({ module: 'QueryPostProcessing' });

/**
 * Persist user and assistant messages to database for continuity and inspection.
 *
 * Deduplication: intermediate messages that were already delivered via streaming
 * are stored only once. If the final resultResponse is identical to the last
 * intermediate message, the duplicate is skipped.
 */
export function persistConversation(
  sessionId: string,
  prompt: string,
  intermediateMessages: string[],
  resultResponse: string,
  agentId: string,
  conversationRepository: IConversationRepository | undefined,
): void {
  if (conversationRepository === undefined) return;

  try {
    conversationRepository.appendMessage(sessionId, 'user', prompt);

    let lastStored = '';
    for (const msg of intermediateMessages) {
      const trimmed = msg.trim();
      if (trimmed.length > 0 && trimmed !== lastStored) {
        conversationRepository.appendMessage(sessionId, 'assistant', msg);
        lastStored = trimmed;
      }
    }

    if (resultResponse.length > 0) {
      const trimmedResult = resultResponse.trim();
      if (trimmedResult !== lastStored) {
        conversationRepository.appendMessage(sessionId, 'assistant', resultResponse);
      }
    }
  } catch (persistError) {
    log.warn(
      { error: persistError, sessionId, agentId },
      'Failed to persist conversation messages'
    );
  }
}

export interface UsageAnomalyReportContext {
  result: QueryResult;
  sessionId: string;
  agentId: string;
  chatId: string;
  userId: string;
  agentCwd: string;
  sdkSessionManager: SDKSessionManager;
  hasResume?: boolean;
  queryMetricId?: number;
  options?: QueryExecuteOptions;
}

export function reportQueryUsageAnomaly(ctx: UsageAnomalyReportContext): UsageAnomalyReport | null {
  const summaryReader = ctx.sdkSessionManager as SDKSessionManager & {
    getSessionSummaries?: () => ReturnType<SDKSessionManager['getSessionSummaries']>;
  };
  const sessionSummary = typeof summaryReader.getSessionSummaries === 'function'
    ? summaryReader.getSessionSummaries().find((summary) => summary.sessionId === ctx.sessionId)
    : undefined;
  const runtime = sessionSummary?.runtimeContext;
  const guildId = runtime?.guildId;
  const targetChatId = runtime?.chatId ?? ctx.chatId;
  const sourceChannelId = runtime?.sourceMessageChannelId ?? ctx.options?.sourceMessageChannelId ?? targetChatId;
  const sourceMessageId = runtime?.originalMessageId ?? ctx.options?.replyToMessageId;
  const discordUrl = buildDiscordChannelUrl(guildId, targetChatId);
  const sourceMessageUrl = buildDiscordMessageUrl(guildId, sourceChannelId, sourceMessageId);
  const cwd = sessionSummary?.cwd ?? ctx.agentCwd;
  const sdkSessionId = ctx.result.sdkSessionId || sessionSummary?.sdkSessionId;
  const jsonlPath = sdkSessionId !== undefined && cwd.length > 0
    ? getJsonlPath(sdkSessionId, cwd)
    : undefined;

  const report = diagnoseQueryUsage(ctx.result, {
    sessionId: ctx.sessionId,
    agentId: ctx.agentId,
    chatId: targetChatId,
    userId: ctx.userId,
    cwd,
    ...(sdkSessionId !== undefined ? { sdkSessionId } : {}),
    ...(ctx.queryMetricId !== undefined ? { queryMetricId: ctx.queryMetricId } : {}),
    ...(discordUrl !== undefined ? { discordUrl } : {}),
    ...(sourceMessageUrl !== undefined ? { sourceMessageUrl } : {}),
    ...(jsonlPath !== undefined ? { jsonlPath } : {}),
    ...(sessionSummary?.messageCount !== undefined ? { sessionMessageCount: sessionSummary.messageCount } : {}),
    ...(ctx.hasResume !== undefined ? { hasResume: ctx.hasResume } : {}),
    ...(sessionSummary?.lastPromptCacheMutation !== undefined ? { promptCacheMutation: sessionSummary.lastPromptCacheMutation } : {}),
  });
  if (report === null) return null;

  const logPayload = {
    event_type: EventType.CACHE_QUERY_ANOMALY,
    sessionId: ctx.sessionId,
    sdkSessionId,
    agentId: ctx.agentId,
    chatId: targetChatId,
    userId: ctx.userId,
    queryMetricId: ctx.queryMetricId,
    severity: report.severity,
    shouldAlert: report.shouldAlert,
    likelyCause: report.likelyCause,
    findings: report.findings.map((finding) => finding.code),
    hasResume: ctx.hasResume,
    sessionMessageCount: sessionSummary?.messageCount,
    modelBreakdown: report.modelBreakdown,
    ...report.metrics,
    discordUrl,
    sourceMessageUrl,
    jsonlPath,
  };
  if (report.shouldAlert) {
    log.warn(logPayload, 'Query usage anomaly detected');
  } else {
    log.info(logPayload, 'Query usage diagnostic note');
  }

  return report;
}
