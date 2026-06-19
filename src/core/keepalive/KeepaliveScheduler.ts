import type { ManagedSession } from '../session/SDKSessionTypes.js';
import type { IQueryMetricsRepository } from '../../persistence/types.js';
import type { CacheKeepaliveConfig } from '../../config.js';
import { buildKeepaliveAuditDiagnostics, auditKeepaliveCacheHit } from './KeepaliveAudit.js';
import { readKeepaliveUsageDelta } from './KeepaliveUsage.js';
import { updateKeepaliveHealingState } from './KeepaliveHealing.js';
import { logKeepaliveROI, recordKeepaliveMetrics } from './KeepaliveMetrics.js';
import { inspectLatestKeepaliveTranscript } from './SDKTranscriptDiagnostics.js';
import { logger } from '../../utils/logger.js';

export interface KeepaliveContext {
  sessionId: string;
  sessions: Map<string, ManagedSession>;
  isDisposed: () => boolean;
  queryMetricsRepository: IQueryMetricsRepository | undefined;
  intervalMs: number;
  skipIfRecentMs: number;
  config: CacheKeepaliveConfig;
}

export function getKeepaliveBaseAt(
  managed: ManagedSession,
): { at: number; source: 'lastCacheTouchAt' | 'lastQueryAt' | 'lastUsedAt' } {
  if (managed.lastCacheTouchAt !== undefined) return { at: managed.lastCacheTouchAt, source: 'lastCacheTouchAt' };
  if (managed.lastQueryAt !== undefined) return { at: managed.lastQueryAt, source: 'lastQueryAt' };
  return { at: managed.lastUsedAt, source: 'lastUsedAt' };
}

export function computeNextKeepaliveDelay(
  managed: ManagedSession,
  intervalMs: number,
  config?: CacheKeepaliveConfig,
): number {
  if (managed.needsCacheWarmup && config?.postQueryWarmupMs) {
    return config.postQueryWarmupMs;
  }
  const { at: lastTouchAt } = getKeepaliveBaseAt(managed);
  const ageMs = Math.max(0, Date.now() - lastTouchAt);
  return Math.max(1_000, intervalMs - ageMs);
}

export function scheduleKeepalive(ctx: KeepaliveContext, delayMs: number): void {
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
      : 'Cache keepalive scheduled',
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
      'Cache keepalive delayed because user query is still running',
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
      'Cache keepalive skipped because prompt cache is already past detected TTL',
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
      'Cache keepalive skipped because cache/user activity is still recent',
    );
    return;
  }

  current.isKeepalivePing = true;
  current.needsCacheWarmup = false;
  try {
    logger.info(
      { sessionId: ctx.sessionId, idleMs, cacheAgeMs, intervalMs: ctx.intervalMs, baseSource: cacheBaseSource, isWarmup },
      'Cache keepalive ping',
    );
    await current.session.send("Reply with only 'ok'");
    const keepaliveSentAt = Date.now();
    current.lastUsedAt = keepaliveSentAt;

    const { usage: keepaliveUsage, modelId: keepaliveModelId } = await readKeepaliveUsageDelta(current);

    if (keepaliveUsage) {
      if ((keepaliveUsage.cacheReadInputTokens ?? 0) > 0 || (keepaliveUsage.cacheCreationInputTokens ?? 0) > 0) {
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
      const auditDiagnostics = buildKeepaliveAuditDiagnostics({
        session: current,
        cacheBaseSource,
        cacheAgeMs,
        isWarmup,
        ...(transcript !== undefined ? { transcript } : {}),
      });
      const audit = auditKeepaliveCacheHit(ctx.sessionId, keepaliveUsage, ctx.intervalMs, ctx.config, auditDiagnostics);

      if (audit.isAnomaly) {
        current.lastKeepaliveAnomaly = {
          at: Date.now(),
          hitPct: audit.hitPct,
          cacheReadTokens: keepaliveUsage.cacheReadInputTokens ?? 0,
          cacheCreationTokens: keepaliveUsage.cacheCreationInputTokens ?? 0,
          freshInputTokens: keepaliveUsage.inputTokens ?? 0,
          ...(audit.likelyCause !== undefined ? { likelyCause: audit.likelyCause } : {}),
          ...(auditDiagnostics.discordUrl !== undefined ? { discordUrl: auditDiagnostics.discordUrl } : {}),
          ...(auditDiagnostics.sourceMessageUrl !== undefined ? { sourceMessageUrl: auditDiagnostics.sourceMessageUrl } : {}),
          ...(transcript?.jsonlPath !== undefined ? { transcriptPath: transcript.jsonlPath } : {}),
          details: audit.details,
        };
      }
      if ((keepaliveUsage.cacheReadInputTokens ?? 0) > 0 || (keepaliveUsage.cacheCreationInputTokens ?? 0) > 0) {
        delete current.lastPromptCacheMutation;
      }

      recordKeepaliveMetrics({
        sessionId: ctx.sessionId,
        sdkSessionId: current.sdkSessionId,
        usage: keepaliveUsage,
        repository: ctx.queryMetricsRepository,
      });
      logKeepaliveROI({
        sessionId: ctx.sessionId,
        usage: keepaliveUsage,
        modelId: keepaliveModelId,
      });
    }

    updateKeepaliveHealingState(ctx.sessionId, current, keepaliveUsage?.cacheCreationInputTokens ?? 0);

    logger.info(
      {
        sessionId: ctx.sessionId,
        event_type: 'sdk.keepalive_completed',
        intervalMs: ctx.intervalMs,
        lastCacheTouchAt: current.lastCacheTouchAt,
        lastUsedAt: current.lastUsedAt,
      },
      'Cache keepalive ping completed',
    );
  } catch (err) {
    logger.warn(
      { sessionId: ctx.sessionId, err: err instanceof Error ? err.message : String(err) },
      'Cache keepalive ping failed',
    );
    if (current.keepaliveTimer) {
      clearTimeout(current.keepaliveTimer);
      current.keepaliveTimer = undefined;
    }
  } finally {
    current.isKeepalivePing = false;
  }
}
