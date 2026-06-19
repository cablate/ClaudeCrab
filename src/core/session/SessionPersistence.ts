import { Mutex } from 'async-mutex';
import { ConfigTransformer } from '../lib/ConfigTransformer.js';
import type { AgentLoader } from '../orchestrator/AgentLoader.js';
import type { ISessionRepository, SessionRow } from '../../persistence/types.js';
import {
  dateToString,
  deserializeMessageIds,
  serializeMessageIds,
  stringToDate,
} from '../../persistence/types.js';
import type { SessionState, SessionStoreConfig, UserSession } from '../../types/session.js';
import { EventType } from '../../utils/events.js';
import { logger } from '../../utils/logger.js';
import type { InternalSession } from './SessionManager.js';

export function toPublicSession(internal: InternalSession): UserSession {
  return {
    sessionId: internal.sessionId,
    agentId: internal.agentId,
    platform: internal.platform,
    userId: internal.userId,
    state: internal.state,
    createdAt: internal.createdAt,
    lastActiveAt: internal.lastActiveAt,
    processedMessageIds: internal.processedMessageIds,
    ...(internal.sdkSessionId !== undefined
      ? { sdkSessionId: internal.sdkSessionId }
      : {}),
    isActive: internal.isActive,
    continuationSource: internal.continuationSource,
    continuationState: internal.continuationState,
  };
}

export function toSessionRow(internal: InternalSession): SessionRow {
  return {
    session_id: internal.sessionId,
    agent_id: internal.agentId,
    platform: internal.platform,
    user_id: internal.userId,
    state: internal.state,
    created_at: dateToString(internal.createdAt),
    last_active_at: dateToString(internal.lastActiveAt),
    sdk_session_id: internal.sdkSessionId ?? null,
    processed_message_ids: serializeMessageIds(internal.processedMessageIds),
    is_active: internal.isActive ? 1 : 0,
    continuation_source: internal.continuationSource ?? null,
    continuation_state: internal.continuationState ?? null,
  };
}

export interface RestoreSessionsOptions {
  sessionRepository: ISessionRepository | undefined;
  config: SessionStoreConfig;
  agentLoader: AgentLoader;
  sessions: Map<string, InternalSession>;
  getSessionKey: (platform: string, agentId: string, userId: string) => string;
}

export async function restoreSessionsFromRepository(options: RestoreSessionsOptions): Promise<number> {
  const { sessionRepository, config, agentLoader, sessions, getSessionKey } = options;
  if (sessionRepository === undefined) {
    return 0;
  }

  const ancientRows = sessionRepository.findExpired(config.dbRetentionMs);
  for (const row of ancientRows) {
    sessionRepository.delete(row.session_id);
  }
  if (ancientRows.length > 0) {
    logger.info({ event_type: EventType.SESSION_PURGED, count: ancientRows.length }, 'Purged ancient sessions from database');
  }

  const expiredRows = sessionRepository.findExpired(config.sessionTimeoutMs);
  const expiredIds = new Set(expiredRows.map((row) => row.session_id));
  if (expiredRows.length > 0) {
    logger.info(
      { event_type: EventType.SESSION_RESTORE_SKIPPED, count: expiredRows.length },
      'Skipped expired sessions (kept in DB for continuity)'
    );
  }

  const rows = sessionRepository.findAll();
  let restored = 0;

  for (const row of rows) {
    if (expiredIds.has(row.session_id)) {
      continue;
    }

    try {
      const agent = agentLoader.get(row.agent_id) ??
        (await agentLoader.loadAgent(row.agent_id));

      const sdkOptions = ConfigTransformer.toSDKOptions(agent);
      const key = getSessionKey(row.platform, row.agent_id, row.user_id);

      if (sessions.has(key)) {
        continue;
      }

      const restoredState = row.state === 'processing' ? 'idle' : row.state;

      if (row.is_active === 0) {
        logger.debug(
          { sessionId: row.session_id, platform: row.platform, userId: row.user_id },
          'Skipped inactive (soft-deleted) session'
        );
        continue;
      }

      const session: InternalSession = {
        sessionId: row.session_id,
        agentId: row.agent_id,
        platform: row.platform,
        userId: row.user_id,
        state: restoredState as SessionState,
        createdAt: stringToDate(row.created_at),
        lastActiveAt: stringToDate(row.last_active_at),
        processedMessageIds: deserializeMessageIds(row.processed_message_ids),
        mutex: new Mutex(),
        agent,
        sdkOptions,
        isActive: true,
      };

      if (row.sdk_session_id !== null) {
        session.sdkSessionId = row.sdk_session_id;
      }

      sessions.set(key, session);
      restored++;

      if (restoredState !== row.state) {
        sessionRepository.updateState(row.session_id, restoredState as SessionState);
        logger.info({ event_type: EventType.SESSION_STATE_TRANSITION, sessionId: row.session_id }, 'Reset stuck processing state to idle');
      }

      logger.debug(
        {
          sessionId: row.session_id,
          platform: row.platform,
          userId: row.user_id,
          hasSdkSessionId: row.sdk_session_id !== null,
        },
        'Session restored from database'
      );
    } catch (error) {
      logger.warn(
        { event_type: EventType.SESSION_ERROR, sessionId: row.session_id, agentId: row.agent_id, err: (error as Error).message },
        'Failed to restore session, agent may not exist'
      );
    }
  }

  if (restored > 0) {
    logger.info({ event_type: EventType.SESSION_RESTORED, count: restored }, 'Sessions restored from database');
  }

  return restored;
}
