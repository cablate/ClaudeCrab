import type { CacheKeepaliveConfig } from '../../config.js';
import { DEFAULT_CACHE_KEEPALIVE_CONFIG } from '../../config.js';
import type { ManagedSession } from '../session/SDKSessionTypes.js';
import { buildDiscordChannelUrl, buildDiscordMessageUrl } from '../../types/runtimeContext.js';
import { EventType } from '../../utils/events.js';
import { logger } from '../../utils/logger.js';
import type { KeepaliveTranscriptDiagnostic } from './SDKTranscriptDiagnostics.js';

export interface KeepaliveUsageDelta {
  inputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface KeepaliveAuditDiagnostics {
  sdkSessionId?: string;
  agentId?: string;
  cwd?: string;
  discordUrl?: string;
  sourceMessageUrl?: string;
  chatId?: string;
  userId?: string;
  cacheBaseSource?: string;
  cacheAgeMs?: number;
  isWarmup?: boolean;
  promptCacheMutation?: ManagedSession['lastPromptCacheMutation'];
  transcript?: KeepaliveTranscriptDiagnostic;
}

export interface KeepaliveAuditResult {
  isAnomaly: boolean;
  hitPct: number | null;
  details: string;
  likelyCause?: string;
}

export interface KeepaliveDiagnosticsInput {
  session: ManagedSession;
  cacheBaseSource: string;
  cacheAgeMs: number;
  isWarmup: boolean;
  transcript?: KeepaliveTranscriptDiagnostic;
}

export function buildKeepaliveAuditDiagnostics(input: KeepaliveDiagnosticsInput): KeepaliveAuditDiagnostics {
  const current = input.session;
  const discordUrl = buildDiscordChannelUrl(current.runtimeContext?.guildId, current.runtimeContext?.chatId);
  const sourceMessageUrl = buildDiscordMessageUrl(
    current.runtimeContext?.guildId,
    current.runtimeContext?.sourceMessageChannelId ?? current.runtimeContext?.chatId,
    current.runtimeContext?.originalMessageId,
  );

  return {
    sdkSessionId: current.sdkSessionId,
    agentId: current.agentId,
    cwd: current.cwd,
    ...(discordUrl !== undefined ? { discordUrl } : {}),
    ...(sourceMessageUrl !== undefined ? { sourceMessageUrl } : {}),
    ...(current.runtimeContext?.chatId !== undefined ? { chatId: current.runtimeContext.chatId } : {}),
    ...(current.runtimeContext?.userId !== undefined ? { userId: current.runtimeContext.userId } : {}),
    cacheBaseSource: input.cacheBaseSource,
    cacheAgeMs: input.cacheAgeMs,
    ...(input.isWarmup ? { isWarmup: true } : {}),
    ...(current.lastPromptCacheMutation !== undefined ? { promptCacheMutation: current.lastPromptCacheMutation } : {}),
    ...(input.transcript !== undefined ? { transcript: input.transcript } : {}),
  };
}

/**
 * Audit a keepalive ping's per-ping usage delta.
 * Logs a warning and returns Discord-ready diagnostic details when cache reuse is poor.
 */
export function auditKeepaliveCacheHit(
  sessionId: string,
  usage: KeepaliveUsageDelta,
  intervalMs: number,
  config: CacheKeepaliveConfig = DEFAULT_CACHE_KEEPALIVE_CONFIG,
  diagnostics: KeepaliveAuditDiagnostics = {},
): KeepaliveAuditResult {
  const fresh = usage.inputTokens ?? 0;
  const cacheRead = usage.cacheReadInputTokens ?? 0;
  const cacheCreation = usage.cacheCreationInputTokens ?? 0;
  const totalInput = fresh + cacheRead + cacheCreation;

  const hitPct = totalInput > 0 ? Math.round((cacheRead / totalInput) * 100) : null;
  const isAnomaly = totalInput > 0 && (hitPct === null || hitPct < config.efficiencyWarnThreshold);
  const likelyCause = diagnostics.transcript?.likelyCause ?? diagnostics.promptCacheMutation?.reason;
  const details = buildKeepaliveDiagnosticDetails(
    sessionId,
    {
      fresh,
      cacheRead,
      cacheCreation,
      hitPct,
      threshold: config.efficiencyWarnThreshold,
      intervalMs,
    },
    diagnostics,
  );
  logger.info(
    {
      sessionId,
      event_type: EventType.SDK_KEEPALIVE_CACHE_MISS,
      cacheHitPct: hitPct,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheCreation,
      freshInputTokens: fresh,
      intervalMs,
      anomaly: isAnomaly,
      likelyCause,
      sdkSessionId: diagnostics.sdkSessionId,
      transcript: diagnostics.transcript,
      promptCacheMutation: diagnostics.promptCacheMutation,
    },
    isAnomaly ? `V2 keepalive cache anomaly (hit ${hitPct ?? 0}% < ${config.efficiencyWarnThreshold}%)` : 'V2 keepalive cache hit'
  );

  return {
    isAnomaly,
    hitPct,
    details,
    ...(likelyCause !== undefined ? { likelyCause } : {}),
  };
}

function buildKeepaliveDiagnosticDetails(
  sessionId: string,
  usage: {
    fresh: number;
    cacheRead: number;
    cacheCreation: number;
    hitPct: number | null;
    threshold: number;
    intervalMs: number;
  },
  diagnostics: KeepaliveAuditDiagnostics,
): string {
  const lines = [
    `session=${sessionId}`,
    diagnostics.sdkSessionId !== undefined ? `sdkSession=${diagnostics.sdkSessionId}` : undefined,
    diagnostics.agentId !== undefined ? `agent=${diagnostics.agentId}` : undefined,
    diagnostics.chatId !== undefined ? `chatId=${diagnostics.chatId}` : undefined,
    diagnostics.userId !== undefined ? `userId=${diagnostics.userId}` : undefined,
    diagnostics.discordUrl !== undefined ? `discordThread=${diagnostics.discordUrl}` : undefined,
    diagnostics.sourceMessageUrl !== undefined ? `discordMessage=${diagnostics.sourceMessageUrl}` : undefined,
    `cacheRead=${usage.cacheRead} cacheCreation=${usage.cacheCreation} fresh=${usage.fresh} hitPct=${usage.hitPct} threshold=${usage.threshold}% intervalMs=${usage.intervalMs}`,
    diagnostics.cacheBaseSource !== undefined ? `cacheBase=${diagnostics.cacheBaseSource} cacheAgeMs=${diagnostics.cacheAgeMs ?? 'unknown'}` : undefined,
    diagnostics.promptCacheMutation !== undefined
      ? `lastPromptCacheMutation=${diagnostics.promptCacheMutation.reason} at=${new Date(diagnostics.promptCacheMutation.at).toISOString()} detail=${diagnostics.promptCacheMutation.detail}`
      : undefined,
    diagnostics.transcript !== undefined ? formatTranscriptDiagnostic(diagnostics.transcript) : undefined,
    diagnostics.cwd !== undefined ? `cwd=${diagnostics.cwd}` : undefined,
    diagnostics.transcript?.likelyCause === 'stop_hook_summary'
      ? 'interpretation=Known post-query Stop hook transcript mutation; lowering keepalive interval is unlikely to fix this specific alert.'
      : 'interpretation=Check transcript previous node and cache TTL before changing keepalive interval.',
  ].filter((line): line is string => line !== undefined && line.length > 0);
  return lines.join('\n');
}

function formatTranscriptDiagnostic(diagnostic: KeepaliveTranscriptDiagnostic): string {
  const parts = [
    `jsonl=${diagnostic.jsonlPath}`,
    diagnostic.keepaliveUserLine !== undefined ? `keepaliveUserLine=${diagnostic.keepaliveUserLine}` : undefined,
    diagnostic.keepaliveAssistantLine !== undefined ? `keepaliveAssistantLine=${diagnostic.keepaliveAssistantLine}` : undefined,
    diagnostic.previousLine !== undefined ? `previousLine=${diagnostic.previousLine}` : undefined,
    diagnostic.previousType !== undefined ? `previousType=${diagnostic.previousType}` : undefined,
    diagnostic.previousSubtype !== undefined ? `previousSubtype=${diagnostic.previousSubtype}` : undefined,
    diagnostic.previousAttachmentType !== undefined ? `previousAttachmentType=${diagnostic.previousAttachmentType}` : undefined,
    diagnostic.likelyCause !== undefined ? `likelyCause=${diagnostic.likelyCause}` : undefined,
    diagnostic.previousSummary !== undefined ? `previousSummary=${diagnostic.previousSummary}` : undefined,
    diagnostic.error !== undefined ? `transcriptError=${diagnostic.error}` : undefined,
  ].filter((part): part is string => part !== undefined && part.length > 0);
  return `transcript: ${parts.join(' ')}`;
}
