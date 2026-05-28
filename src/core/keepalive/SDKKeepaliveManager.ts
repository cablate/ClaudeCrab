/**
 * SDKKeepaliveManager ??cache keepalive timer logic for V2 sessions.
 *
 * Extracted from SDKSessionManager.ts (startKeepalive, auditKeepaliveCacheHit,
 * updateCacheEfficiency).
 *
 * Cache keepalive interval. Anthropic API cache TTL:
 * - Standard accounts: 5 minutes
 * - Claude Max / first-party: up to 1 hour
 * Default: 1 minute to cover the 5-min minimum TTL with headroom.
 *
 * Configurable via env:
 *   CACHE_KEEPALIVE_INTERVAL_MS      ??ping interval (default 60000 = 1 min; 0 = disable)
 *   CACHE_KEEPALIVE_SKIP_RECENT_MS   ??skip if session used within this window (default 15000 = 15 sec)
 */

import type { QueryUsage } from '../query/SDKQueryManager.js';
import type { ManagedSession } from '../session/SDKSessionTypes.js';
import type { IQueryMetricsRepository } from '../../persistence/types.js';
import type { CacheKeepaliveConfig } from '../../config.js';
import { DEFAULT_CACHE_KEEPALIVE_CONFIG } from '../../config.js';
import { calculatePingROI } from '../../services/KeepaliveROIService.js';
import { getCachedQueryIterator } from '../query/SDKStreamProcessor.js';
import { inspectLatestKeepaliveTranscript, type KeepaliveTranscriptDiagnostic } from './SDKTranscriptDiagnostics.js';
import { buildDiscordChannelUrl, buildDiscordMessageUrl } from '../../types/runtimeContext.js';
import { logger } from '../../utils/logger.js';
import { EventType } from '../../utils/events.js';

export const CACHE_KEEPALIVE_INTERVAL_MS = DEFAULT_CACHE_KEEPALIVE_CONFIG.intervalMs;
/** Cache efficiency threshold ??warn if rolling average drops below this */
export const CACHE_EFFICIENCY_WARN_THRESHOLD = DEFAULT_CACHE_KEEPALIVE_CONFIG.efficiencyWarnThreshold;
/** Cooldown between identical keepalive-miss alerts (1 hour) */
export const KEEPALIVE_ALERT_COOLDOWN_MS = DEFAULT_CACHE_KEEPALIVE_CONFIG.alertCooldownMs;

export function computeDetectedTTLKeepaliveIntervalMs(
  detectedTTLMs: number,
  config: CacheKeepaliveConfig = DEFAULT_CACHE_KEEPALIVE_CONFIG,
): number {
  return Math.max(config.minIntervalMs, Math.round(detectedTTLMs * config.detectedTTLRatio));
}

interface KeepaliveContext {
  sessionId: string;
  sessions: Map<string, ManagedSession>;
  isDisposed: () => boolean;
  queryMetricsRepository: IQueryMetricsRepository | undefined;
  intervalMs: number;
  skipIfRecentMs: number;
  config: CacheKeepaliveConfig;
}

interface KeepaliveAuditDiagnostics {
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
  message: string;
  details: string;
  likelyCause?: string;
  links?: Array<{ label: string; url: string }>;
}

function getKeepaliveBaseAt(managed: ManagedSession): { at: number; source: 'lastCacheTouchAt' | 'lastQueryAt' | 'lastUsedAt' } {
  if (managed.lastCacheTouchAt !== undefined) return { at: managed.lastCacheTouchAt, source: 'lastCacheTouchAt' };
  if (managed.lastQueryAt !== undefined) return { at: managed.lastQueryAt, source: 'lastQueryAt' };
  return { at: managed.lastUsedAt, source: 'lastUsedAt' };
}

function computeNextKeepaliveDelay(managed: ManagedSession, intervalMs: number, config?: CacheKeepaliveConfig): number {
  if (managed.needsCacheWarmup && config?.postQueryWarmupMs) {
    return config.postQueryWarmupMs;
  }
  const { at: lastTouchAt } = getKeepaliveBaseAt(managed);
  const ageMs = Math.max(0, Date.now() - lastTouchAt);
  return Math.max(1_000, intervalMs - ageMs);
}

function scheduleKeepalive(ctx: KeepaliveContext, delayMs: number): void {
  const managed = ctx.sessions.get(ctx.sessionId);
  if (!managed || ctx.isDisposed()) return;

  if (managed.keepaliveTimer) {
    clearTimeout(managed.keepaliveTimer);
  }

  const base = getKeepaliveBaseAt(managed);
  const isWarmup = managed.needsCacheWarmup === true;
  logger.info(
    {
      sessionId: ctx.sessionId,
      event_type: 'sdk.keepalive_scheduled',
      delayMs,
      intervalMs: ctx.intervalMs,
      baseSource: base.source,
      baseAgeMs: Date.now() - base.at,
      lastCacheTouchAt: managed.lastCacheTouchAt,
      lastQueryAt: managed.lastQueryAt,
      lastUsedAt: managed.lastUsedAt,
      ...(isWarmup ? { isWarmup } : {}),
    },
    isWarmup
      ? `Cache warmup keepalive scheduled in ${Math.round(delayMs / 1000)}s`
      : 'Cache keepalive scheduled'
  );

  managed.keepaliveTimer = setTimeout(() => {
    void runScheduledKeepalive(ctx);
  }, delayMs);
}

async function runScheduledKeepalive(ctx: KeepaliveContext): Promise<void> {
  const current = ctx.sessions.get(ctx.sessionId);
  if (!current || ctx.isDisposed()) return;

  if (current.isQuerying) {
    logger.info(
      { sessionId: ctx.sessionId, event_type: 'sdk.keepalive_delayed_querying', retryMs: ctx.config.queryingRetryMs },
      'Cache keepalive delayed because user query is still running'
    );
    scheduleKeepalive(ctx, ctx.config.queryingRetryMs);
    return;
  }

  await executeKeepalivePing(ctx);

  const latest = ctx.sessions.get(ctx.sessionId);
  if (!latest || ctx.isDisposed() || !latest.keepaliveTimer) return;
  scheduleKeepalive(ctx, computeNextKeepaliveDelay(latest, ctx.intervalMs, ctx.config));
}

async function executeKeepalivePing(ctx: KeepaliveContext): Promise<void> {
  const current = ctx.sessions.get(ctx.sessionId);
  if (!current || current.isQuerying || ctx.isDisposed()) return;

  const now = Date.now();
  const idleMs = now - current.lastUsedAt;
  const { at: cacheBaseAt, source: cacheBaseSource } = getKeepaliveBaseAt(current);
  const cacheAgeMs = now - cacheBaseAt;
  const detectedTTLMs = current.detectedCacheTTLMs;
  if (detectedTTLMs !== undefined && cacheAgeMs >= detectedTTLMs) {
    logger.warn(
      {
        sessionId: ctx.sessionId,
        event_type: 'sdk.keepalive_expired_before_ping',
        cacheAgeMs,
        detectedTTLMs,
        intervalMs: ctx.intervalMs,
        baseSource: cacheBaseSource,
      },
      'Cache keepalive skipped because prompt cache is already past detected TTL'
    );
    current.keepaliveTimer = undefined;
    return;
  }

  const isWarmup = current.needsCacheWarmup === true;

  if (!isWarmup && (idleMs < ctx.skipIfRecentMs || cacheAgeMs < ctx.intervalMs)) {
    logger.info(
      {
        sessionId: ctx.sessionId,
        event_type: 'sdk.keepalive_skipped_recent',
        idleMs,
        cacheAgeMs,
        intervalMs: ctx.intervalMs,
        skipIfRecentMs: ctx.skipIfRecentMs,
        baseSource: cacheBaseSource,
      },
      'Cache keepalive skipped because cache/user activity is still recent'
    );
    return;
  }
  current.isKeepalivePing = true;
  current.needsCacheWarmup = false;
  try {
    logger.info({ sessionId: ctx.sessionId, idleMs, cacheAgeMs, intervalMs: ctx.intervalMs, baseSource: cacheBaseSource, isWarmup }, 'Cache keepalive ping');
    await current.session.send("Reply with only 'ok'");
    const keepaliveSentAt = Date.now();
    current.lastUsedAt = keepaliveSentAt;

    let keepaliveUsage: {
      inputTokens?: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
    } | undefined;
    let keepaliveModelId: string | undefined;
    const queryIter = getCachedQueryIterator(current.session);
    if (queryIter) {
      while (true) {
        const { done, value: message } = await queryIter.next();
        if (done) break;
        if (message.type === 'result') {
          const m = message as { modelUsage?: Record<string, {
            inputTokens?: number;
            cacheReadInputTokens?: number;
            cacheCreationInputTokens?: number;
          }> };
          if (m.modelUsage) {
            const modelKeys = Object.keys(m.modelUsage);
            if (modelKeys.length > 0) keepaliveModelId = modelKeys[0];
            let cumIn = 0, cumRead = 0, cumCreate = 0;
            for (const mu of Object.values(m.modelUsage)) {
              cumIn += mu.inputTokens ?? 0;
              cumRead += mu.cacheReadInputTokens ?? 0;
              cumCreate += mu.cacheCreationInputTokens ?? 0;
            }
            const prev = current.prevUsage;
            keepaliveUsage = {
              inputTokens: Math.max(0, cumIn - prev.inputTokens),
              cacheReadInputTokens: Math.max(0, cumRead - prev.cacheReadInputTokens),
              cacheCreationInputTokens: Math.max(0, cumCreate - prev.cacheCreationInputTokens),
            };
            current.prevUsage = {
              ...prev,
              inputTokens: cumIn,
              cacheReadInputTokens: cumRead,
              cacheCreationInputTokens: cumCreate,
            };
          }
          break;
        }
      }
    }

    if (keepaliveUsage) {
      if (
        (keepaliveUsage.cacheReadInputTokens ?? 0) > 0 ||
        (keepaliveUsage.cacheCreationInputTokens ?? 0) > 0
      ) {
        current.lastCacheTouchAt = keepaliveSentAt;
      }

      const totalKeepaliveInput =
        (keepaliveUsage.inputTokens ?? 0) +
        (keepaliveUsage.cacheReadInputTokens ?? 0) +
        (keepaliveUsage.cacheCreationInputTokens ?? 0);
      const keepaliveHitPct = totalKeepaliveInput > 0
        ? Math.round(((keepaliveUsage.cacheReadInputTokens ?? 0) / totalKeepaliveInput) * 100)
        : null;
      const transcript = totalKeepaliveInput > 0 && (keepaliveHitPct === null || keepaliveHitPct < ctx.config.efficiencyWarnThreshold)
        ? inspectLatestKeepaliveTranscript(current.sdkSessionId, current.cwd)
        : undefined;
      const discordUrl = buildDiscordChannelUrl(current.runtimeContext?.guildId, current.runtimeContext?.chatId);
      const sourceMessageUrl = buildDiscordMessageUrl(
        current.runtimeContext?.guildId,
        current.runtimeContext?.sourceMessageChannelId ?? current.runtimeContext?.chatId,
        current.runtimeContext?.originalMessageId,
      );

      const audit = auditKeepaliveCacheHit(
        ctx.sessionId,
        keepaliveUsage,
        ctx.intervalMs,
        ctx.config,
        {
          sdkSessionId: current.sdkSessionId,
          agentId: current.agentId,
          cwd: current.cwd,
          ...(discordUrl !== undefined ? { discordUrl } : {}),
          ...(sourceMessageUrl !== undefined ? { sourceMessageUrl } : {}),
          ...(current.runtimeContext?.chatId !== undefined ? { chatId: current.runtimeContext.chatId } : {}),
          ...(current.runtimeContext?.userId !== undefined ? { userId: current.runtimeContext.userId } : {}),
          cacheBaseSource,
          cacheAgeMs,
          ...(isWarmup ? { isWarmup } : {}),
          ...(current.lastPromptCacheMutation !== undefined ? { promptCacheMutation: current.lastPromptCacheMutation } : {}),
          ...(transcript !== undefined ? { transcript } : {}),
        },
      );

      if (audit.isAnomaly) {
        current.lastKeepaliveAnomaly = {
          at: Date.now(),
          hitPct: audit.hitPct,
          cacheReadTokens: keepaliveUsage.cacheReadInputTokens ?? 0,
          cacheCreationTokens: keepaliveUsage.cacheCreationInputTokens ?? 0,
          freshInputTokens: keepaliveUsage.inputTokens ?? 0,
          ...(audit.likelyCause !== undefined ? { likelyCause: audit.likelyCause } : {}),
          ...(discordUrl !== undefined ? { discordUrl } : {}),
          ...(sourceMessageUrl !== undefined ? { sourceMessageUrl } : {}),
          ...(transcript?.jsonlPath !== undefined ? { transcriptPath: transcript.jsonlPath } : {}),
          details: audit.details,
        };
      }
      if (
        (keepaliveUsage.cacheReadInputTokens ?? 0) > 0 ||
        (keepaliveUsage.cacheCreationInputTokens ?? 0) > 0
      ) {
        delete current.lastPromptCacheMutation;
      }

      if (ctx.queryMetricsRepository) {
        try {
          ctx.queryMetricsRepository.record({
            agentId: 'system',
            platform: 'keepalive',
            chatId: ctx.sessionId,
            userId: 'system',
            inputTokens: keepaliveUsage.inputTokens ?? 0,
            outputTokens: 0,
            cacheReadTokens: keepaliveUsage.cacheReadInputTokens ?? 0,
            cacheCreationTokens: keepaliveUsage.cacheCreationInputTokens ?? 0,
            totalCostUsd: 0,
            numTurns: 1,
            durationMs: 0,
            turnType: 'keepalive',
            sdkSessionId: current.sdkSessionId,
          });
        } catch (err) {
          logger.warn({ sessionId: ctx.sessionId, err }, 'Failed to record keepalive metrics');
        }
      }

      const roi = calculatePingROI({
        inputTokens: keepaliveUsage.inputTokens ?? 0,
        outputTokens: 0,
        cacheReadTokens: keepaliveUsage.cacheReadInputTokens ?? 0,
        cacheCreationTokens: keepaliveUsage.cacheCreationInputTokens ?? 0,
        totalCostUsd: 0,
      }, keepaliveModelId ?? 'claude-opus-4');
      if (roi.savings !== 0) {
        logger.info(
          { sessionId: ctx.sessionId, event_type: EventType.CACHE_KEEPALIVE_PING, ...roi },
          `Keepalive ROI: saved $${roi.savings.toFixed(6)} (ratio: ${roi.roiRatio?.toFixed(2) ?? 'N/A'})`
        );
      }
    }
    const cacheCreationTokens = keepaliveUsage?.cacheCreationInputTokens ?? 0;
    const HEALING_THRESHOLD = 50;
    const HEALING_MAX_RETRIES = 3;
    if (cacheCreationTokens > HEALING_THRESHOLD) {
      const retries = current.healingRetryCount ?? 0;
      if (retries < HEALING_MAX_RETRIES) {
        current.needsCacheWarmup = true;
        current.healingRetryCount = retries + 1;
        logger.info(
          {
            sessionId: ctx.sessionId,
            event_type: 'sdk.keepalive_healing_scheduled',
            cacheCreationTokens,
            threshold: HEALING_THRESHOLD,
            healingRetry: retries + 1,
            maxRetries: HEALING_MAX_RETRIES,
          },
          retries > 0
            ? `Healing retry ${retries + 1}/${HEALING_MAX_RETRIES} ??still saw creation ${cacheCreationTokens}`
            : `Keepalive cache creation ${cacheCreationTokens} > ${HEALING_THRESHOLD} ??scheduling healing warmup`
        );
      } else {
        current.healingRetryCount = 0;
        logger.warn(
          {
            sessionId: ctx.sessionId,
            event_type: 'sdk.keepalive_healing_exhausted',
            cacheCreationTokens,
            retries: HEALING_MAX_RETRIES,
          },
          `Healing exhausted after ${HEALING_MAX_RETRIES} retries ??cache prefix likely permanently drifted`
        );
      }
    } else if ((current.healingRetryCount ?? 0) > 0) {
      logger.info(
        { sessionId: ctx.sessionId, event_type: 'sdk.keepalive_healing_resolved', retries: current.healingRetryCount },
        `Healing resolved after ${current.healingRetryCount} retries`
      );
      current.healingRetryCount = 0;
    }

    logger.info(
      {
        sessionId: ctx.sessionId,
        event_type: 'sdk.keepalive_completed',
        intervalMs: ctx.intervalMs,
        lastCacheTouchAt: current.lastCacheTouchAt,
        lastUsedAt: current.lastUsedAt,
      },
      'Cache keepalive ping completed'
    );
  } catch (err) {
    logger.warn(
      { sessionId: ctx.sessionId, err: err instanceof Error ? err.message : String(err) },
      'Cache keepalive ping failed'
    );
    if (current.keepaliveTimer) {
      clearTimeout(current.keepaliveTimer);
      current.keepaliveTimer = undefined;
    }
  } finally {
    current.isKeepalivePing = false;
  }
}

/**
 * Start cache keepalive timer for a session.
 * Sends lightweight pings to prevent Anthropic API prompt cache TTL expiry.
 */
export function startKeepalive(
  sessionId: string,
  sessions: Map<string, ManagedSession>,
  isDisposed: () => boolean,
  queryMetricsRepository?: IQueryMetricsRepository,
  config: CacheKeepaliveConfig = DEFAULT_CACHE_KEEPALIVE_CONFIG,
): void {
  const managed = sessions.get(sessionId);
  if (!managed) return;

  if (managed.keepaliveTimer) {
    clearTimeout(managed.keepaliveTimer);
  }

  if (config.enabled === false) {
    logger.info({ sessionId, event_type: 'sdk.keepalive_disabled' }, 'Cache keepalive disabled (CACHE_KEEPALIVE_ENABLED=false)');
    return;
  }

  if (config.intervalMs <= 0) {
    logger.info({ sessionId }, 'Cache keepalive disabled (CACHE_KEEPALIVE_INTERVAL_MS=0)');
    return;
  }

  const ctx: KeepaliveContext = {
    sessionId,
    sessions,
    isDisposed,
    queryMetricsRepository,
    intervalMs: config.intervalMs,
    skipIfRecentMs: config.skipRecentMs,
    config,
  };

  managed.currentKeepaliveIntervalMs = config.intervalMs;
  scheduleKeepalive(ctx, computeNextKeepaliveDelay(managed, config.intervalMs, config));
}

/**
 * Restart keepalive timer when detected cache TTL refines the interval.
 * Called after SDKStreamProcessor detects the cache tier from API response.
 */
export function adjustKeepaliveInterval(
  sessionId: string,
  sessions: Map<string, ManagedSession>,
  detectedTTLMs: number,
  isDisposed: () => boolean,
  queryMetricsRepository?: IQueryMetricsRepository,
  config: CacheKeepaliveConfig = DEFAULT_CACHE_KEEPALIVE_CONFIG,
): void {
  const managed = sessions.get(sessionId);
  if (!managed || !managed.keepaliveTimer) return;
  if (config.enabled === false) return;

  const targetInterval = computeDetectedTTLKeepaliveIntervalMs(detectedTTLMs, config);
  const currentInterval = managed.currentKeepaliveIntervalMs ?? config.intervalMs;

  if (currentInterval === targetInterval) {
    managed.currentKeepaliveIntervalMs = currentInterval;
    scheduleKeepalive(
      {
        sessionId,
        sessions,
        isDisposed,
        queryMetricsRepository,
        intervalMs: currentInterval,
        skipIfRecentMs: Math.round(currentInterval * 0.5),
        config,
      },
      computeNextKeepaliveDelay(managed, currentInterval, config),
    );
    return;
  }

  logger.info(
    { sessionId, detectedTTLMs, currentIntervalMs: currentInterval, newIntervalMs: targetInterval, event_type: 'sdk.keepalive_interval_adjusted' },
    `Keepalive interval updated for detected TTL ??restarting timer at ${Math.round(targetInterval / 60000)} min`
  );

  clearTimeout(managed.keepaliveTimer);
  managed.keepaliveTimer = undefined;
  managed.currentKeepaliveIntervalMs = targetInterval;

  const ctx: KeepaliveContext = {
    sessionId,
    sessions,
    isDisposed,
    queryMetricsRepository,
    intervalMs: targetInterval,
    skipIfRecentMs: Math.round(targetInterval * 0.5),
    config,
  };

  scheduleKeepalive(ctx, computeNextKeepaliveDelay(managed, targetInterval, config));
}

/**
 * Audit a keepalive ping's per-ping usage delta.
 * Logs a warning and emits an activity event if the cache TTL expired.
 */
export function auditKeepaliveCacheHit(
  sessionId: string,
  usage: { inputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number },
  intervalMs: number = CACHE_KEEPALIVE_INTERVAL_MS,
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
  const intervalMinutes = Math.round(intervalMs / 60000);
  const message = [
    `??Cache anomaly: session ${sessionId} keepalive hit rate ${hitPct ?? 0}% (threshold ${config.efficiencyWarnThreshold}%).`,
    `Paid ${fresh} fresh + ${cacheCreation} creation tokens (interval ${intervalMinutes}min).`,
    likelyCause !== undefined && likelyCause !== 'unknown'
      ? `Likely cause: ${formatLikelyCause(likelyCause)}.`
      : undefined,
  ].filter(Boolean).join(' ');
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
  const links = buildKeepaliveAlertLinks(diagnostics);

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
    message,
    details,
    ...(likelyCause !== undefined ? { likelyCause } : {}),
    ...(links.length > 0 ? { links } : {}),
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

function formatLikelyCause(cause: string): string {
  switch (cause) {
    case 'stop_hook_summary':
      return 'stop_hook_summary changed the transcript after the previous cache write';
    case 'mcp_instructions_delta':
      return 'MCP instructions changed the prompt tail';
    case 'hook_blocking_error':
      return 'a hook blocking error changed the prompt tail';
    default:
      return cause;
  }
}

function buildKeepaliveAlertLinks(diagnostics: KeepaliveAuditDiagnostics): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];
  if (diagnostics.discordUrl !== undefined) {
    links.push({ label: 'Discord thread', url: diagnostics.discordUrl });
  }
  if (
    diagnostics.sourceMessageUrl !== undefined &&
    diagnostics.sourceMessageUrl !== diagnostics.discordUrl
  ) {
    links.push({ label: 'Source message', url: diagnostics.sourceMessageUrl });
  }
  return links;
}

/**
 * Update rolling cache efficiency average for a session and warn if below threshold.
 */
export function updateCacheEfficiency(
  sessionId: string,
  managed: ManagedSession,
  usage: QueryUsage,
  config: CacheKeepaliveConfig = DEFAULT_CACHE_KEEPALIVE_CONFIG,
): void {
  const totalInput = (usage.inputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0);
  if (totalInput === 0) return;

  if ((usage.cacheReadInputTokens ?? 0) > 0 || (usage.cacheCreationInputTokens ?? 0) > 0) {
    managed.lastCacheTouchAt = Date.now();
  }

  if (!managed.isKeepalivePing) {
    managed.needsCacheWarmup = true;
  }

  const efficiency = Math.round(((usage.cacheReadInputTokens ?? 0) / totalInput) * 100);

  const prev = managed.cacheEfficiencyAvg ?? efficiency;
  managed.cacheEfficiencyAvg = Math.round(prev * 0.7 + efficiency * 0.3);

  if (managed.messageCount > 2 && managed.cacheEfficiencyAvg < config.efficiencyWarnThreshold) {
    logger.warn(
      {
        event_type: EventType.CACHE_EFFICIENCY_WARN,
        sessionId,
        currentEfficiency: efficiency,
        rollingAvg: managed.cacheEfficiencyAvg,
        messageCount: managed.messageCount,
        threshold: config.efficiencyWarnThreshold,
      },
      `Cache efficiency below ${config.efficiencyWarnThreshold}% ??possible cache bust issue`
    );
  }

  if (managed.messageCount === 2 || managed.messageCount % 10 === 0) {
    logger.info(
      {
        event_type: EventType.CACHE_EFFICIENCY_SNAPSHOT,
        sessionId,
        messageCount: managed.messageCount,
        currentEfficiency: efficiency,
        rollingAvg: managed.cacheEfficiencyAvg,
        cacheReadTokens: usage.cacheReadInputTokens,
        cacheCreationTokens: usage.cacheCreationInputTokens,
        inputTokens: usage.inputTokens,
      },
      'Cache efficiency snapshot'
    );
  }
}
