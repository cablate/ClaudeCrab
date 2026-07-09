import type { ConversationRuntimeContext } from '../../types/runtimeContext.js';
import { CACHE_EFFICIENCY_WARN_THRESHOLD } from '../keepalive/SDKKeepaliveManager.js';
import type { ManagedSession } from './SDKSessionTypes.js';

export interface SDKSessionSummary {
  sessionId: string;
  sdkSessionId: string;
  createdAt: number;
  lastQueryAt: number;
  lastUsedAt: number;
  messageCount: number;
  contextTokens: number | undefined;
  contextWindowSize: number | undefined;
  cacheEfficiencyAvg: number | undefined;
  totalCostUsd: number;
  isQuerying: boolean;
  agentId: string;
  cwd: string;
  runtimeContext: ConversationRuntimeContext | undefined;
  lastPromptCacheMutation: ManagedSession['lastPromptCacheMutation'] | undefined;
  lastKeepaliveAnomaly: ManagedSession['lastKeepaliveAnomaly'] | undefined;
}

export interface SessionCacheActivityState {
  lastActivityAt: number;
  source: 'lastCacheTouchAt' | 'lastQueryAt' | 'lastUsedAt';
  lastCacheTouchAt: number | undefined;
  lastQueryAt: number | undefined;
  lastUsedAt: number;
}

export interface SessionGuardState {
  guardShownForLength: boolean;
  guardLastShownTokenCount: number | undefined;
  guardShownForCacheTTL: boolean;
}

export interface CacheStats {
  active_sessions: number;
  avg_cache_efficiency_pct: number | null;
  low_efficiency_sessions: number;
  querying_sessions: number;
  total_messages: number;
}

export function getSessionTokenCount(managed: ManagedSession | undefined): number | null {
  if (!managed || managed.lastTurnContextTokens === undefined) return null;
  return managed.lastTurnContextTokens;
}

export function getSessionCacheActivityState(managed: ManagedSession | undefined): SessionCacheActivityState | null {
  if (!managed) return null;
  if (managed.lastCacheTouchAt !== undefined) {
    return {
      lastActivityAt: managed.lastCacheTouchAt,
      source: 'lastCacheTouchAt',
      lastCacheTouchAt: managed.lastCacheTouchAt,
      lastQueryAt: managed.lastQueryAt,
      lastUsedAt: managed.lastUsedAt,
    };
  }
  if (managed.lastQueryAt !== undefined) {
    return {
      lastActivityAt: managed.lastQueryAt,
      source: 'lastQueryAt',
      lastCacheTouchAt: managed.lastCacheTouchAt,
      lastQueryAt: managed.lastQueryAt,
      lastUsedAt: managed.lastUsedAt,
    };
  }
  return {
    lastActivityAt: managed.lastUsedAt,
    source: 'lastUsedAt',
    lastCacheTouchAt: managed.lastCacheTouchAt,
    lastQueryAt: managed.lastQueryAt,
    lastUsedAt: managed.lastUsedAt,
  };
}

export function getDetectedCacheTTLMs(managed: ManagedSession | undefined): number | null {
  return managed?.detectedCacheTTLMs ?? null;
}

export function getSessionGuardState(managed: ManagedSession | undefined): SessionGuardState | null {
  if (!managed) return null;
  return {
    guardShownForLength: managed.guardShownForLength === true,
    guardLastShownTokenCount: managed.guardLastShownTokenCount,
    guardShownForCacheTTL: managed.guardShownForCacheTTL === true,
  };
}

export function setSessionGuardState(managed: ManagedSession | undefined, state: {
  guardShownForLength?: boolean;
  guardLastShownTokenCount?: number;
  guardShownForCacheTTL?: boolean;
}): void {
  if (!managed) return;
  if (state.guardShownForLength !== undefined) managed.guardShownForLength = state.guardShownForLength;
  if (state.guardLastShownTokenCount !== undefined) managed.guardLastShownTokenCount = state.guardLastShownTokenCount;
  if (state.guardShownForCacheTTL !== undefined) managed.guardShownForCacheTTL = state.guardShownForCacheTTL;
}

export function getSessionStats(managed: ManagedSession | undefined): { messageCount: number; ageMs: number } | null {
  if (!managed) return null;
  return {
    messageCount: managed.messageCount,
    ageMs: Date.now() - managed.createdAt,
  };
}

export function getCacheStats(sessions: Map<string, ManagedSession>): CacheStats {
  let effSum = 0;
  let effCount = 0;
  let low = 0;
  let querying = 0;
  let totalMessages = 0;
  for (const session of sessions.values()) {
    totalMessages += session.messageCount;
    if (session.isQuerying) querying++;
    if (typeof session.cacheEfficiencyAvg === 'number') {
      effSum += session.cacheEfficiencyAvg;
      effCount++;
      if (session.cacheEfficiencyAvg < CACHE_EFFICIENCY_WARN_THRESHOLD) low++;
    }
  }
  return {
    active_sessions: sessions.size,
    avg_cache_efficiency_pct: effCount > 0 ? Math.round(effSum / effCount) : null,
    low_efficiency_sessions: low,
    querying_sessions: querying,
    total_messages: totalMessages,
  };
}

export function getSessionSummaries(sessions: Map<string, ManagedSession>): SDKSessionSummary[] {
  const result: SDKSessionSummary[] = [];
  for (const [sessionId, session] of sessions) {
    result.push({
      sessionId,
      sdkSessionId: session.sdkSessionId,
      createdAt: session.createdAt,
      lastQueryAt: session.lastQueryAt,
      lastUsedAt: session.lastUsedAt,
      messageCount: session.messageCount,
      contextTokens: session.lastTurnContextTokens,
      contextWindowSize: session.contextWindowSize,
      cacheEfficiencyAvg: session.cacheEfficiencyAvg,
      totalCostUsd: session.prevUsage.totalCostUsd,
      isQuerying: session.isQuerying,
      agentId: session.agentId,
      cwd: session.cwd,
      runtimeContext: session.runtimeContext,
      lastPromptCacheMutation: session.lastPromptCacheMutation,
      lastKeepaliveAnomaly: session.lastKeepaliveAnomaly,
    });
  }
  return result;
}
