import type { McpSdkServerConfigWithInstance, Options } from '@anthropic-ai/claude-agent-sdk';
import type { LoadedAgent } from '../../types/agent.js';
import type { QueryResult, ExecuteQueryOptions } from './types.js';
import type { SDKSessionManager } from '../session/SDKSessionManager.js';
import { logger } from '../../utils/logger.js';
import {
  retryAsync,
  API_RETRY_OPTIONS,
  isRateLimitError,
  isTransientError,
} from '../../utils/retry.js';

const log = logger.child({ module: 'QuerySdkRunner' });

export interface QuerySdkRunnerOptions {
  sessionId: string;
  sdkPrompt: string;
  agent: LoadedAgent;
  platform: 'discord';
  chatId: string;
  userId: string;
  systemPrompt: string;
  sdkSessionManager: SDKSessionManager;
  resumeId: string | undefined;
  continuationState: string | undefined;
  runtimeContext: NonNullable<ExecuteQueryOptions['runtimeContext']>;
  maxTurns?: number | undefined;
  mcpServers: Record<string, McpSdkServerConfigWithInstance>;
  allowedTools: string[];
  canUseTool: NonNullable<Options['canUseTool']>;
  onIntermediateMessage: NonNullable<ExecuteQueryOptions['onIntermediateMessage']>;
  onToolEvent: NonNullable<ExecuteQueryOptions['onToolEvent']>;
  onSubAgentEvent: NonNullable<ExecuteQueryOptions['onSubAgentEvent']>;
  onHookEvent: NonNullable<ExecuteQueryOptions['onHookEvent']>;
  subAgentManager?: ExecuteQueryOptions['subAgentManager'];
  clearIntermediateMessages: () => void;
  preserveSdkSessionId: (sdkSessionId: string) => void;
}

export async function executeSdkQueryWithRetry(options: QuerySdkRunnerOptions): Promise<QueryResult> {
  return await retryAsync(
    async () => {
      try {
        return await options.sdkSessionManager.executeQuery(
          options.sessionId,
          options.sdkPrompt,
          options.agent,
          buildExecuteOptions(options),
        );
      } catch (v2Error) {
        handleV2Error(options, v2Error);
      }
    },
    {
      ...API_RETRY_OPTIONS,
      isRetryable: (err) =>
        !(err instanceof Error && '_cancelled' in err) &&
        !(err instanceof Error && '_v1FallbackDisabled' in err) &&
        !(err instanceof Error && '_resumeRetryDisabled' in err) &&
        !(err instanceof Error && '_zombieRetryDisabled' in err) &&
        !(err instanceof Error && '_emptyStreamRetryDisabled' in err) &&
        (isRateLimitError(err) || isTransientError(err)),
      onRetry: (attempt, err, delayMs) => {
        options.clearIntermediateMessages();
        log.warn(
          {
            sessionId: options.sessionId,
            attempt,
            delayMs,
            error: err instanceof Error ? err.message : String(err),
          },
          'Retrying SDK query'
        );
      },
    }
  );
}

function buildExecuteOptions(options: QuerySdkRunnerOptions): ExecuteQueryOptions {
  return {
    cwd: options.agent.path,
    systemPrompt: options.systemPrompt,
    runtimeContext: options.runtimeContext,
    ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
    ...(Object.keys(options.mcpServers).length > 0
      ? { mcpServers: options.mcpServers, allowedTools: options.allowedTools }
      : {}),
    resume: options.resumeId,
    ...(options.continuationState === 'pending' ? { requireResume: true } : {}),
    onIntermediateMessage: options.onIntermediateMessage,
    onToolEvent: options.onToolEvent,
    onSubAgentEvent: options.onSubAgentEvent,
    onHookEvent: options.onHookEvent,
    ...(options.subAgentManager ? { subAgentManager: options.subAgentManager } : {}),
    additionalOptions: { canUseTool: options.canUseTool },
  };
}

function handleV2Error(options: QuerySdkRunnerOptions, v2Error: unknown): never {
  const errMsg = v2Error instanceof Error
    ? v2Error.message
    : typeof v2Error === 'object' && v2Error !== null && 'value' in v2Error
      ? String((v2Error as { value: unknown }).value)
      : String(v2Error);

  if (
    errMsg.includes('cancelled by user') ||
    errMsg.includes('aborted by user') ||
    (errMsg.includes('ede_diagnostic') && errMsg.includes('stop_reason=tool_use'))
  ) {
    const savedSdkSessionId = (v2Error as { _sdkSessionId?: string })._sdkSessionId;
    if (savedSdkSessionId) {
      options.preserveSdkSessionId(savedSdkSessionId);
      log.info(
        { sessionId: options.sessionId, sdkSessionId: savedSdkSessionId },
        'V2 query interrupted/cancelled - sdkSessionId preserved for resume'
      );
    } else {
      log.info({ sessionId: options.sessionId, errMsg }, 'V2 query interrupted/cancelled - no sdkSessionId to preserve');
    }
    throw Object.assign(new Error('Query cancelled'), { _cancelled: true });
  }

  if (
    v2Error instanceof Error &&
    (
      '_resumeRequired' in v2Error ||
      '_resumeRetryDisabled' in v2Error ||
      '_zombieRetryDisabled' in v2Error ||
      '_emptyStreamRetryDisabled' in v2Error
    )
  ) {
    throw v2Error;
  }

  const savedSdkSessionId = (v2Error as { _sdkSessionId?: string })._sdkSessionId;
  log.warn(
    { sessionId: options.sessionId, error: errMsg, sdkSessionId: savedSdkSessionId },
    'V2 persistent session failed; V1 fallback disabled'
  );
  options.sdkSessionManager.destroySession(options.sessionId);

  const fallbackDisabledError = new Error(
    `V2 persistent session failed and V1 fallback is disabled to prevent duplicate high-cost query. Original error: ${errMsg}`
  );
  const typedError = fallbackDisabledError as Error & {
    _v1FallbackDisabled: true;
    _sdkSessionId?: string;
  };
  typedError._v1FallbackDisabled = true;
  if (savedSdkSessionId !== undefined) typedError._sdkSessionId = savedSdkSessionId;
  throw typedError;
}
