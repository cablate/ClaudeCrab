import type { CacheKeepaliveConfig } from '../../config.js';
import type { IQueryMetricsRepository } from '../../persistence/types.js';
import type { LoadedAgent } from '../../types/agent.js';
import { logger } from '../../utils/logger.js';
import { startKeepalive } from '../keepalive/SDKKeepaliveManager.js';
import type { ExecuteQueryOptions } from '../query/types.js';
import { createManagedSession } from './SDKSessionFactory.js';
import type { ManagedSession } from './SDKSessionTypes.js';

export interface CreateSessionContext {
  sessionId: string;
  agent: LoadedAgent;
  options: ExecuteQueryOptions;
  sessions: Map<string, ManagedSession>;
  ephemeral: boolean;
  disposed: () => boolean;
  queryMetricsRepository: IQueryMetricsRepository | undefined;
  keepaliveConfig: CacheKeepaliveConfig;
}

export async function createSdkManagedSession(ctx: CreateSessionContext): Promise<ManagedSession> {
  const managed = await createManagedSession(
    ctx.sessionId,
    ctx.agent,
    ctx.options,
    (session) => {
      ctx.sessions.set(ctx.sessionId, session);
    },
  );

  restoreResumeContextFromJsonl(ctx, managed);
  startSessionKeepalive(ctx);
  logSessionCreated(ctx);

  return managed;
}

function restoreResumeContextFromJsonl(ctx: CreateSessionContext, managed: ManagedSession): void {
  const resumeSessionId = ctx.options.resume;
  if (resumeSessionId === undefined || managed.lastTurnContextTokens !== undefined) {
    return;
  }

  import('./SDKContextRestore.js').then(({ restoreContextFromJsonl }) =>
    restoreContextFromJsonl(resumeSessionId, ctx.options.cwd).then((contextTokens) => {
      if (contextTokens !== null && managed.lastTurnContextTokens === undefined) {
        managed.lastTurnContextTokens = contextTokens;
        logger.info(
          {
            sessionId: ctx.sessionId,
            sdkSessionId: resumeSessionId,
            contextTokens,
            event_type: 'sdk.context_restored',
          },
          `Context restored from JSONL: ${Math.round(contextTokens / 1000)}K tokens`
        );
      } else {
        logger.debug(
          {
            sessionId: ctx.sessionId,
            sdkSessionId: resumeSessionId,
            event_type: 'sdk.context_restore_skip',
          },
          contextTokens === null ? 'No JSONL context data found' : 'Context already set by stream'
        );
      }
    })
  ).catch((err) => {
    logger.warn(
      {
        sessionId: ctx.sessionId,
        sdkSessionId: resumeSessionId,
        err: err instanceof Error ? err.message : String(err),
      },
      'Context restore from JSONL failed'
    );
  });
}

function startSessionKeepalive(ctx: CreateSessionContext): void {
  if (ctx.ephemeral) return;

  startKeepalive(
    ctx.sessionId,
    ctx.sessions,
    ctx.disposed,
    ctx.queryMetricsRepository,
    ctx.keepaliveConfig,
  );
}

function logSessionCreated(ctx: CreateSessionContext): void {
  logger.info(
    {
      sessionId: ctx.sessionId,
      keepaliveIntervalMs: ctx.keepaliveConfig.intervalMs,
      keepaliveSkipRecentMs: ctx.keepaliveConfig.skipRecentMs,
      keepaliveDetectedTTLRatio: ctx.keepaliveConfig.detectedTTLRatio,
      ephemeral: ctx.ephemeral,
    },
    ctx.ephemeral
      ? 'V2 ephemeral session created (will be destroyed after query)'
      : 'V2 persistent session registered (with cache keepalive)'
  );
}
