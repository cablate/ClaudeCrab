import type { ManagedSession } from '../session/SDKSessionTypes.js';
import { getCachedQueryIterator } from '../session/SDKSessionInternals.js';
import type { KeepaliveUsageDelta } from './KeepaliveAudit.js';

export interface KeepaliveUsageSnapshot {
  usage?: KeepaliveUsageDelta;
  modelId?: string;
}

interface ModelUsage {
  inputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

/**
 * Read the SDK result event after a keepalive ping and convert cumulative model
 * usage into this ping's delta.
 */
export async function readKeepaliveUsageDelta(session: ManagedSession): Promise<KeepaliveUsageSnapshot> {
  const queryIter = getCachedQueryIterator(session.session);
  if (!queryIter) return {};

  while (true) {
    const { done, value: message } = await queryIter.next();
    if (done) break;
    if (message.type !== 'result') continue;

    const result = message as { modelUsage?: Record<string, ModelUsage> };
    if (result.modelUsage === undefined) break;

    const modelKeys = Object.keys(result.modelUsage);
    const modelId = modelKeys[0];
    let cumIn = 0;
    let cumRead = 0;
    let cumCreate = 0;
    for (const usage of Object.values(result.modelUsage)) {
      cumIn += usage.inputTokens ?? 0;
      cumRead += usage.cacheReadInputTokens ?? 0;
      cumCreate += usage.cacheCreationInputTokens ?? 0;
    }

    const prev = session.prevUsage;
    session.prevUsage = {
      ...prev,
      inputTokens: cumIn,
      cacheReadInputTokens: cumRead,
      cacheCreationInputTokens: cumCreate,
    };

    return {
      usage: {
        inputTokens: Math.max(0, cumIn - prev.inputTokens),
        cacheReadInputTokens: Math.max(0, cumRead - prev.cacheReadInputTokens),
        cacheCreationInputTokens: Math.max(0, cumCreate - prev.cacheCreationInputTokens),
      },
      ...(modelId !== undefined ? { modelId } : {}),
    };
  }

  return {};
}
