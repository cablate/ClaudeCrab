import { Mutex } from 'async-mutex';
import { v4 as uuidv4 } from 'uuid';
import type { LoadedAgent } from '../../types/agent.js';
import type { CreateSessionOptions } from '../../types/session.js';
import type { SessionRow } from '../../persistence/types.js';
import type { SDKOptions } from '../lib/ConfigTransformer.js';
import { EventType } from '../../utils/events.js';
import { logger } from '../../utils/logger.js';
import type { InternalSession } from './SessionManager.js';

export interface PreviousSessionState {
  previousSessionId?: string;
  previousSdkSessionId?: string;
  previousContinuationSource?: 'schedule' | null;
  previousContinuationState?: 'pending' | 'active' | null;
}

export function extractPreviousSessionState(row: SessionRow | undefined): PreviousSessionState {
  if (row === undefined) {
    return {};
  }

  const previous: PreviousSessionState = {
    previousSessionId: row.session_id,
  };
  const previousIsActive = row.is_active !== 0;

  if (previousIsActive) {
    if (row.sdk_session_id !== null) {
      previous.previousSdkSessionId = row.sdk_session_id;
    }
    previous.previousContinuationSource = row.continuation_source as 'schedule' | null;
    previous.previousContinuationState = row.continuation_state as 'pending' | 'active' | null;
  }

  logger.info(
    {
      event_type: EventType.SESSION_RESTORE_BEGIN,
      previousSessionId: previous.previousSessionId,
      previousSdkSessionId: previous.previousSdkSessionId ?? null,
      previousIsActive: row.is_active,
      previousCreatedAt: row.created_at,
      continuationSource: previous.previousContinuationSource,
      continuationState: previous.previousContinuationState,
    },
    `Inheriting session from DB; sdkSessionId=${previous.previousSdkSessionId ?? 'none'}, isActive=${row.is_active}`
  );

  return previous;
}

export interface BuildInternalSessionOptions {
  options: CreateSessionOptions;
  agent: LoadedAgent;
  sdkOptions: SDKOptions;
  previous: PreviousSessionState;
}

export function buildInternalSession({
  options,
  agent,
  sdkOptions,
  previous,
}: BuildInternalSessionOptions): InternalSession {
  const now = new Date();
  const inheritedSdkSessionId = options.inheritedSdkSessionId;
  const { platform, userId, agentId } = options;

  return {
    sessionId: previous.previousSessionId ?? uuidv4(),
    agentId,
    platform,
    userId,
    state: 'idle',
    createdAt: now,
    lastActiveAt: now,
    processedMessageIds: new Set(),
    mutex: new Mutex(),
    agent,
    sdkOptions,
    ...(inheritedSdkSessionId !== undefined
      ? { sdkSessionId: inheritedSdkSessionId }
      : previous.previousSdkSessionId !== undefined
        ? { sdkSessionId: previous.previousSdkSessionId }
        : {}),
    isActive: true,
    continuationSource: previous.previousContinuationSource ?? undefined,
    continuationState: previous.previousContinuationState ?? undefined,
  };
}
