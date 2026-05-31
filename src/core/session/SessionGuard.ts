import type { BaseAdapter } from '../../adapters/BaseAdapter.js';
import type { SDKSessionManager } from './SDKSessionManager.js';
import type { UserSession } from '../../types/session.js';
import { QuestionBridge } from '../interaction/QuestionBridge.js';
import { InteractionHandler } from '../interaction/InteractionHandler.js';
import { logger } from '../../utils/logger.js';
import { EventType } from '../../utils/events.js';

export interface SessionGuardConfig {
  enabled: boolean;
  tokenThreshold: number;
  cacheTTLMs: number;
}

export interface SessionGuardDeps {
  sdkSessionManager: SDKSessionManager;
  adapter: BaseAdapter;
  chatId: string;
  agentCwd?: string | undefined;
}

const GUARD_TIMEOUT_MS = 60_000;

/**
 * Check session length and cache TTL before processing.
 * Returns 'switch' if the user chose to abandon the session.
 */
export async function checkSessionGuard(
  deps: SessionGuardDeps,
  session: UserSession,
  config: SessionGuardConfig
): Promise<'continue' | 'switch' | 'timeout'> {
  const { sdkSessionManager, adapter, chatId } = deps;
  const log = logger.child({ module: 'session-guard', sessionId: session.sessionId });

  let cacheActivityState = sdkSessionManager.getSessionCacheActivityState(session.sessionId);
  let lastActivityAt = cacheActivityState?.lastActivityAt ?? null;
  let guardState = sdkSessionManager.getSessionGuardState(session.sessionId);
  let tokenCount = sdkSessionManager.getSessionTokenCount(session.sessionId);

  // Resume guard: ManagedSession doesn't exist but session will resume (has sdkSessionId).
  // Read context size from JSONL so the guard can fire before paying rebuild cost.
  if ((lastActivityAt === null || guardState === null) && session.sdkSessionId && deps.agentCwd) {
    try {
      const { restoreContextFromJsonl } = await import('./SDKContextRestore.js');
      tokenCount = await restoreContextFromJsonl(session.sdkSessionId, deps.agentCwd);
    } catch { /* I/O error → don't block message processing */ }

    if (tokenCount !== null) {
      guardState = { guardShownForLength: false, guardLastShownTokenCount: undefined, guardShownForCacheTTL: false };
      // Use JSONL file mtime as proxy for last activity — only trigger cache guard if actually idle past TTL
      try {
        const { getJsonlMtimeMs } = await import('./SDKContextRestore.js');
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by outer resume condition
        lastActivityAt = getJsonlMtimeMs(session.sdkSessionId!, deps.agentCwd!) ?? 0;
      } catch {
        lastActivityAt = 0;
      }
      log.info(
        { event_type: EventType.SESSION_GUARD_RESUME, tokenCount, sdkSessionId: session.sdkSessionId, lastActivityAt, activitySource: 'jsonlMtime' },
        `Resume guard: restored ${Math.round(tokenCount / 1000)}K tokens from JSONL`
      );
      cacheActivityState = {
        lastActivityAt,
        source: 'lastUsedAt',
        lastCacheTouchAt: undefined,
        lastQueryAt: undefined,
        lastUsedAt: lastActivityAt,
      };
    }
  }

  if (lastActivityAt === null || guardState === null) {
    return 'continue';
  }
  const detectedTTL = sdkSessionManager.getDetectedCacheTTLMs(session.sessionId);
  const effectiveCacheTTL = detectedTTL ?? config.cacheTTLMs;
  const now = Date.now();
  const idleMs = now - lastActivityAt;
  const idleMin = Math.round(idleMs / 60000);

  // --- Cache TTL guard ---
  if (!guardState.guardShownForCacheTTL && idleMs > effectiveCacheTTL) {
    log.info(
      {
        event_type: EventType.SESSION_GUARD_CACHE_TTL,
        idleMs,
        cacheTTLMs: effectiveCacheTTL,
        detected: detectedTTL !== null,
        activitySource: cacheActivityState?.source,
        lastCacheTouchAt: cacheActivityState?.lastCacheTouchAt,
        lastQueryAt: cacheActivityState?.lastQueryAt,
        lastUsedAt: cacheActivityState?.lastUsedAt,
      },
      'Session idle beyond cache TTL — showing cache guard prompt'
    );
    sdkSessionManager.setSessionGuardState(session.sessionId, { guardShownForCacheTTL: true });

    const cachedTokens = tokenCount ?? sdkSessionManager.getSessionTokenCount(session.sessionId) ?? 0;
    const estimatedRebuildCost = (cachedTokens * 6.25) / 1_000_000;
    const costNote = cachedTokens > 0
      ? ` Rebuilding cache (~${Math.round(cachedTokens / 1000)}K tokens) will cost ~$${estimatedRebuildCost.toFixed(4)}.`
      : '';

    const result = await showGuardPrompt(adapter, chatId, {
      header: 'Cache Expired',
      question: `Session idle ${idleMin} min — prompt cache likely expired.${costNote} Continuing may rebuild cache and burn quota. Switch session unless you explicitly accept that cost.`,
      options: [
        { label: 'Continue and rebuild cache', description: `Proceed anyway (estimated rebuild ~$${estimatedRebuildCost.toFixed(4)})` },
        { label: 'Switch session', description: 'Avoid rebuilding the expired prompt cache' },
      ],
    });

    if (result === null) {
      log.info({ event_type: EventType.SESSION_GUARD_CACHE_TTL }, 'Cache TTL guard timed out — aborting message');
      return 'timeout';
    }
    if (result === 'Switch session') {
      log.info({ event_type: EventType.SESSION_GUARD_CACHE_TTL_SWITCH }, 'User chose to switch session (cache TTL guard)');
      return 'switch';
    }
    log.info({ event_type: EventType.SESSION_GUARD_CACHE_TTL_CONTINUE }, 'User chose to continue (cache TTL guard)');
    return 'continue';
  }

  // --- Session length guard (token based) ---
  // SDKSessionManager stores the last completed turn's context size and subtracts
  // the first-turn baseline, so this reflects conversation growth rather than
  // fixed system prompt/tool definition cost.
  const shouldFireLengthGuard = tokenCount !== null &&
    tokenCount >= config.tokenThreshold;

  if (shouldFireLengthGuard && tokenCount !== null) {
    const currentTokenCount = tokenCount;
    log.info(
      { event_type: EventType.SESSION_GUARD_TOKEN_LENGTH, tokenCount: currentTokenCount, threshold: config.tokenThreshold },
      'Session token count above threshold — showing length guard prompt'
    );
    sdkSessionManager.setSessionGuardState(session.sessionId, {
      guardShownForLength: true,
      guardLastShownTokenCount: currentTokenCount,
    });

    const result = await showGuardPrompt(adapter, chatId, {
      header: 'Session Too Long',
      question: `Session token count (~${currentTokenCount.toLocaleString()} tokens) exceeds the recommended limit (${config.tokenThreshold.toLocaleString()}). Continue or switch?`,
      options: [
        { label: 'Continue', description: 'Continue with current session' },
        { label: 'Switch session', description: 'Destroy this session' },
      ],
    });

    if (result === null) {
      log.info({ event_type: EventType.SESSION_GUARD_TOKEN_LENGTH }, 'Token length guard timed out — aborting message');
      return 'timeout';
    }
    if (result === 'Switch session') {
      log.info({ event_type: EventType.SESSION_GUARD_TOKEN_SWITCH }, 'User chose to switch session (token length guard)');
      return 'switch';
    }
    log.info({ event_type: EventType.SESSION_GUARD_TOKEN_CONTINUE }, 'User chose to continue (token length guard)');
  }

  // --- Rate limit approaching warning (non-blocking, inform only) ---
  try {
    const { getOAuthUsage } = await import('../../services/OAuthUsageService.js');
    const oauthUsage = await getOAuthUsage();
    if (oauthUsage) {
      const RATE_LIMIT_WARN_PCT = 80;
      const warnings: string[] = [];
      if (oauthUsage.five_hour && oauthUsage.five_hour.utilization >= RATE_LIMIT_WARN_PCT) {
        warnings.push(`5h: ${oauthUsage.five_hour.utilization.toFixed(1)}%`);
      }
      if (oauthUsage.seven_day && oauthUsage.seven_day.utilization >= RATE_LIMIT_WARN_PCT) {
        warnings.push(`7d: ${oauthUsage.seven_day.utilization.toFixed(1)}%`);
      }
      if (warnings.length > 0) {
        await adapter.sendFormattedMessage(chatId, `-# ⚠️ Rate limit approaching: ${warnings.join(' · ')}`);
      }
    }
  } catch { /* ignore */ }

  return 'continue';
}

interface GuardPromptOptions {
  header: string;
  question: string;
  options: Array<{ label: string; description: string }>;
}

/**
 * Show a guard prompt via QuestionBridge (same pattern as InteractionHandler).
 * Returns the selected option label, or null on timeout/abort.
 *
 * Note: The guard temporarily installs its own questionResolver that routes
 * through the InteractionHandler static registry. Both the guard resolver and
 * the InteractionHandler resolver are functionally identical (both call
 * `InteractionHandler.resolveQuestionFromAdapter`), so overwriting is safe.
 * The resolver is restored via finally to avoid subtle coupling if the call
 * order ever changes.
 */
async function showGuardPrompt(
  adapter: BaseAdapter,
  chatId: string,
  opts: GuardPromptOptions
): Promise<string | null> {
  const bridge = new QuestionBridge(GUARD_TIMEOUT_MS);
  const optionLabels = opts.options.map((o) => o.label);

  const ac = new AbortController();
  const { requestId, promise } = bridge.requestQuestion(
    opts.question,
    opts.header,
    optionLabels,
    { signal: ac.signal }
  );

  // Save reference to the original resolver setter — used in finally to restore.
  // This captures the overridden `setQuestionResolver` (DiscordAdapter stores
  // the resolver internally), NOT a specific resolver closure.
  const origSetResolver = adapter.setQuestionResolver?.bind(adapter);

  InteractionHandler.questionRegistry.set(requestId, bridge);

  let promptMessageId: string | undefined;
  try {
    // Install guard resolver — note: both guard and InteractionHandler
    // resolvers ultimately route through InteractionHandler.resolveQuestionFromAdapter,
    // making them functionally equivalent. The restore in finally() is still
    // done for defensive correctness.
    adapter.setQuestionResolver?.((id, answer) => {
      InteractionHandler.resolveQuestionFromAdapter(id, answer);
    });

    const sendResult = await adapter.sendQuestionPrompt(chatId, {
      requestId,
      header: opts.header,
      question: opts.question,
      options: opts.options,
      multiSelect: false,
    });
    if (sendResult?.success && sendResult.messageId) {
      promptMessageId = sendResult.messageId;
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), module: 'session-guard' },
      'sendQuestionPrompt failed — auto-continuing'
    );
    ac.abort();
    InteractionHandler.questionRegistry.delete(requestId);
    return null;
  } finally {
    // Restore the original resolver so the InteractionHandler's bridge routing
    // continues to work for subsequent AskUserQuestion tool calls.
    origSetResolver?.((_id: string, _answer: string | null) => {
      InteractionHandler.resolveQuestionFromAdapter(_id, _answer);
    });
  }

  const answer = await promise;
  InteractionHandler.questionRegistry.delete(requestId);

  if (answer.answer === null && promptMessageId) {
    try {
      await adapter.updateQuestionPrompt(chatId, promptMessageId, '⏳ 操作逾時，訊息未處理。請重新發送。');
    } catch { /* best effort */ }
  }

  return answer.answer;
}
