/**
 * SDKSessionFactory: creates and initializes ManagedSession objects.
 *
 * Extracted from SDKSessionManager.ts (createSession method).
 * Responsible for:
 *   - Config assembly (ExtendedSessionOptions building)
 *   - CLI binary resolution (resolveCliPath)
 *   - Hook callback setup (UserPromptSubmit, PostToolUse, PreCompact, Stop)
 *   - V2 session creation via unstable_v2_createSession / unstable_v2_resumeSession
 */

import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
} from '../sdk/index.js';
import type { LoadedAgent } from '../../types/agent.js';
import type { ExecuteQueryOptions } from '../query/types.js';
import { logger } from '../../utils/logger.js';
import { EventType } from '../../utils/events.js';
import { HOOK_DEFS } from '../hooks/definitions.js';
import { extractHookAgentContext, extractHookReadInput } from '../hooks/payload.js';
import type { ManagedSession, ExtendedSessionOptions } from './SDKSessionTypes.js';
import { buildSessionOptions } from './SDKSessionOptions.js';

export type { ManagedSession, ExtendedSessionOptions };

function createPreToolDeny(permissionDecisionReason: string, additionalContext?: string) {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse' as const,
      permissionDecision: 'deny' as const,
      permissionDecisionReason,
      ...(additionalContext !== undefined ? { additionalContext } : {}),
    },
  };
}

function formatKiB(bytes: number): string {
  return `${Math.ceil(bytes / 1024)}KB`;
}

function mergeHookConfig(
  base: Record<string, unknown>,
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (extra === undefined) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const [eventName, matchers] of Object.entries(extra)) {
    const baseMatchers = merged[eventName];
    merged[eventName] = Array.isArray(baseMatchers) && Array.isArray(matchers)
      ? [...baseMatchers, ...matchers]
      : matchers;
  }
  return merged;
}

async function evaluateLargeReadPreflight(
  input: unknown,
  cwd: string,
): Promise<{ readonly message: string; readonly reason: string } | undefined> {
  const config = HOOK_DEFS.contextEconomy.largeReadPreflight;
  if (!config.enabled) return undefined;

  const readInput = extractHookReadInput(input);
  if (readInput.filePath === undefined || readInput.bounded) return undefined;

  const absolutePath = path.isAbsolute(readInput.filePath)
    ? readInput.filePath
    : path.resolve(cwd, readInput.filePath);

  let fileStat;
  try {
    fileStat = await stat(absolutePath);
  } catch {
    return undefined;
  }

  if (!fileStat.isFile() || fileStat.size <= config.maxUnboundedBytes) {
    return undefined;
  }

  const message = `${config.message}: ${formatKiB(fileStat.size)} > ${formatKiB(config.maxUnboundedBytes)}`;
  const reason = `Large unbounded Read blocked: ${formatKiB(fileStat.size)} file exceeds ${formatKiB(config.maxUnboundedBytes)} preflight limit. Use offset/limit or Grep first.`;

  return { message, reason };
}

/**
 * Create a new persistent V2 session and return a ManagedSession.
 * The `sessions` Map is updated by the caller (SDKSessionManager) after this returns.
 *
 * @param sessionId     ClaudeCab conversation ID (for logging / hook closures)
 * @param agent         Loaded agent config
 * @param options       ExecuteQueryOptions forwarded from executeQuery
 * @param onCreated     Called synchronously after ManagedSession is constructed so
 *                        the caller can register it in the sessions Map BEFORE the
 *                        async keepalive timer is started.
 */
export async function createManagedSession(
  sessionId: string,
  agent: LoadedAgent,
  options: ExecuteQueryOptions,
  onCreated: (managed: ManagedSession) => void,
): Promise<ManagedSession> {
  const { sessionOptions, resumeSessionId } = await buildSessionOptions(sessionId, agent, options);

  // Build a temporary managed object so hook closures can reference it.
  // The object is fully constructed below; hooks capture it by reference.
  const managed: ManagedSession = {
    // session is set after SDK call below; use a placeholder until then
    session: null as unknown as ManagedSession['session'],
    sdkSessionId: resumeSessionId ?? '',
    agentId: agent.id,
    model: sessionOptions.model,
    cwd: options.cwd,
    ...(options.runtimeContext !== undefined ? { runtimeContext: options.runtimeContext } : {}),
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    lastQueryAt: Date.now(),
    messageCount: 0,
    prevUsage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUsd: 0, totalCostUsd: 0 },
    prevModelUsage: {},
    isQuerying: false,
  };

  // Hooks close over `managed` (session-scoped mutable state)
  const builtInHooks: Record<string, unknown> = {
    PreToolUse: [
      {
        matcher: 'Read',
        hooks: [async (input: unknown) => {
          const agentContext = extractHookAgentContext(input);
          if (agentContext.isSubagent) return { continue: true };
          const largeReadPreflight = await evaluateLargeReadPreflight(input, options.cwd);
          if (largeReadPreflight !== undefined) {
            logger.warn(
              {
                sessionId,
                event_type: EventType.CONTEXT_ECONOMY_BLOCK,
                toolName: 'Read',
                reason: largeReadPreflight.reason,
              },
              'Context economy denied large unbounded Read'
            );
            return createPreToolDeny(largeReadPreflight.reason);
          }
          return { continue: true };
        }],
      },
      ...(HOOK_DEFS.contextEconomy.mainContextBlockedTools.enabled
        ? HOOK_DEFS.contextEconomy.mainContextBlockedTools.tools.map((toolName) => ({
            matcher: toolName,
            hooks: [(input: unknown) => {
              const agentContext = extractHookAgentContext(input);
              if (agentContext.isSubagent) return Promise.resolve({ continue: true });
              logger.warn(
                {
                  sessionId,
                  event_type: EventType.CONTEXT_ECONOMY_BLOCK,
                  toolName,
                },
                'Context economy denied main-context web tool'
              );
              return Promise.resolve(createPreToolDeny(
                `Main-context ${toolName} is blocked by Context Economy. Delegate broad web/source discovery to Agent with subagent_type="scout".`,
              ));
            }],
          }))
        : []),
    ],
    PreCompact: [{
      matcher: '',
      hooks: [(input: unknown) => {
        const currentOptions = managed.currentOptions ?? options;
        const { trigger } = input as { trigger?: string };
        logger.info(
          { sessionId, event_type: EventType.SDK_HOOK_CB_PRE_COMPACT, trigger, keepalive: managed.isKeepalivePing === true },
          'V2 callback hook fired: PreCompact'
        );
        if (managed.isKeepalivePing === true) {
          return Promise.resolve({ continue: true });
        }
        if (currentOptions.onHookEvent) {
          const def = HOOK_DEFS.preCompact;
          try {
            void currentOptions.onHookEvent({
              kind: 'pre_compact',
              lifecycle: 'fired',
              correlationKey: `${sessionId}:pc:${Date.now()}`,
              name: def.displayName,
              message: def.message,
            });
          } catch {
            logger.debug({ sessionId }, 'pre_compact onHookEvent failed — non-fatal');
          }
        }
        return Promise.resolve({ continue: true });
      }],
    }],
  };
  sessionOptions.hooks = mergeHookConfig(
    builtInHooks,
    (options.hooks ?? options.additionalOptions?.hooks) as Record<string, unknown> | undefined,
  );

  // Create or resume the SDK session
  let session: ManagedSession['session'];
  if (resumeSessionId) {
    // Layer 2: detect incomplete JSONL tail before resume
    try {
      const { inspectJsonlTailIntegrity } = await import('../keepalive/SDKTranscriptDiagnostics.js');
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- cwd is guaranteed in resume path
      const tail = inspectJsonlTailIntegrity(resumeSessionId, sessionOptions.cwd!);
      if (!tail.isComplete && !tail.error) {
        logger.warn(
          {
            sessionId,
            sdkSessionId: resumeSessionId,
            tailType: tail.tailType,
            tailSubtype: tail.tailSubtype,
            tailLine: tail.tailLine,
            tailStopReason: tail.tailStopReason,
            lastStableAssistantLine: tail.lastStableAssistantLine,
            danglingTypes: tail.danglingTypes,
            totalLines: tail.totalLines,
            event_type: 'sdk.jsonl_tail_incomplete',
          },
          `JSONL tail incomplete on resume; last stable end_turn at line ${tail.lastStableAssistantLine ?? 'none'}, tail is ${tail.tailType}/${tail.tailSubtype ?? '-'} at line ${tail.tailLine}`
        );
      } else if (tail.error) {
        logger.warn({ sessionId, sdkSessionId: resumeSessionId, error: tail.error }, 'JSONL tail integrity check failed');
      } else {
        logger.debug({ sessionId, sdkSessionId: resumeSessionId, totalLines: tail.totalLines }, 'JSONL tail integrity OK');
      }
    } catch (err) {
      logger.debug({ sessionId, err: err instanceof Error ? err.message : String(err) }, 'JSONL tail integrity check skipped');
    }

    session = unstable_v2_resumeSession(
      resumeSessionId,
      sessionOptions as unknown as Parameters<typeof unstable_v2_resumeSession>[1]
    );
  } else {
    session = unstable_v2_createSession(
      sessionOptions as unknown as Parameters<typeof unstable_v2_createSession>[0]
    );
  }

  // Patch session onto the already-constructed managed object
  managed.session = session;

  // Notify caller so it can register in the sessions Map before keepalive starts
  onCreated(managed);

  logger.info(
    {
      sessionId,
      sdkSessionId: managed.sdkSessionId,
      hasResume: !!resumeSessionId,
      sessionOpts: {
        model: sessionOptions.model,
        cwd: sessionOptions.cwd,
        settingSources: sessionOptions.settingSources,
        permissionMode: sessionOptions.permissionMode,
        allowedToolsCount: sessionOptions.allowedTools?.length ?? 0,
        agents: Object.keys(sessionOptions.agents ?? {}),
        agentModels: Object.fromEntries(
          Object.entries(sessionOptions.agents ?? {}).map(([name, definition]) => [
            name,
            definition.model ?? 'inherit',
          ]),
        ),
        hasMcpServers: sessionOptions.mcpServers ? Object.keys(sessionOptions.mcpServers).length : 0,
      },
    },
    'V2 persistent session created'
  );

  return managed;
}
