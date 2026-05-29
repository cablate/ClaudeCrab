/**
 * SDKSessionFactory ??creates and initialises ManagedSession objects.
 *
 * Extracted from SDKSessionManager.ts (createSession method).
 * Responsible for:
 *   - Config assembly (ExtendedSessionOptions building)
 *   - CLI binary resolution (resolveCliPath)
 *   - Hook callback setup (UserPromptSubmit, PostToolUse, PreCompact, Stop)
 *   - V2 session creation via unstable_v2_createSession / unstable_v2_resumeSession
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
} from '@anthropic-ai/claude-agent-sdk';
import type { LoadedAgent, Model } from '../../types/agent.js';
import { ConfigTransformer } from '../lib/ConfigTransformer.js';
import { projectHash } from '../lib/JsonlSanitizer.js';
import type { ExecuteQueryOptions } from '../query/SDKQueryManager.js';
import { logger } from '../../utils/logger.js';
import { EventType } from '../../utils/events.js';
import { resolveCliPath } from '../../utils/cliPath.js';
import { HOOK_DEFS } from '../hooks/definitions.js';
import { loadFoundationSubagents } from '../subagents/foundationSubagents.js';
import { extractHookAgentContext, extractHookReadInput } from '../hooks/payload.js';
import type { ManagedSession, ExtendedSessionOptions } from './SDKSessionTypes.js';

export type { ManagedSession, ExtendedSessionOptions };

async function loadAgentSettingsEnv(agentPath: string): Promise<Record<string, string>> {
  const settingsPath = path.join(agentPath, '.claude', 'settings.local.json');
  try {
    const content = await readFile(settingsPath, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const env = parsed.env;
    if (env && typeof env === 'object' && !Array.isArray(env)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
  } catch {
    // file missing or invalid JSON ??fall through to empty env
  }
  return {};
}

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
 * @param sessionId     ??ClaudeCab conversation ID (for logging / hook closures)
 * @param agent         ??Loaded agent config
 * @param options       ??ExecuteQueryOptions forwarded from executeQuery
 * @param onCreated     ??Called synchronously after ManagedSession is constructed so
 *                        the caller can register it in the sessions Map BEFORE the
 *                        async keepalive timer is started.
 */
export async function createManagedSession(
  sessionId: string,
  agent: LoadedAgent,
  options: ExecuteQueryOptions,
  onCreated: (managed: ManagedSession) => void,
): Promise<ManagedSession> {
  const settingsEnv = await loadAgentSettingsEnv(agent.path);
  const wantsApiKeyAuth = typeof settingsEnv.ANTHROPIC_API_KEY === 'string' && settingsEnv.ANTHROPIC_API_KEY.length > 0;

  // When the agent runs against a non-Anthropic API endpoint (settings.local.json
  // declares ANTHROPIC_API_KEY), redirect CLAUDE_CONFIG_DIR to the agent's own
  // .claude/ so the child CLI cannot read user-level OAuth credentials and falls
  // back to the API key from settings.env. The agent's conversation jsonl will
  // live under <agent>/.claude/projects/, isolated from other agents.
  const redirectedConfigDir = wantsApiKeyAuth ? path.join(agent.path, '.claude') : undefined;

  // If a previous session's jsonl is not present under the redirected CONFIG_DIR
  // (typical on first switch from OAuth to API-key auth), force a fresh SDK
  // session instead of letting the child CLI fail with "No conversation found".
  let resumeSessionId = options.resume;
  if (resumeSessionId && redirectedConfigDir) {
    const expectedJsonl = path.join(
      redirectedConfigDir,
      'projects',
      projectHash(options.cwd ?? agent.path),
      `${resumeSessionId}.jsonl`,
    );
    try {
      await stat(expectedJsonl);
    } catch {
      logger.info(
        { sessionId, sdkSessionId: resumeSessionId, expectedJsonl, event_type: 'session.resume_fresh_for_redirected_config' },
        'Resume target jsonl not in redirected CLAUDE_CONFIG_DIR; starting fresh SDK session',
      );
      resumeSessionId = undefined;
    }
  }

  const sessionOptions: ExtendedSessionOptions = {
    model: ConfigTransformer.resolveModel(agent.config.model ?? 'sonnet' as Model),
    cwd: options.cwd,
    permissionMode: 'default',
    settingSources: options.settingSources ?? ['project', 'local'],
    env: {
      CLAUDE_CODE_REMOTE: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CODE_ENABLE_TASKS: '0',
      ...settingsEnv,
      ...(wantsApiKeyAuth
        ? {
            ANTHROPIC_AUTH_TOKEN: '',
            CLAUDE_CONFIG_DIR: redirectedConfigDir!,
          }
        : {}),
    },
    includeHookEvents: true,
    agentProgressSummaries: true,
    forwardSubagentText: false,
    agents: {
      ...loadFoundationSubagents(ConfigTransformer.resolveModel),
      ...(options.additionalOptions?.agents ?? {}),
    },
  };

  // Shared skills directory
  if (options.additionalDirectories && options.additionalDirectories.length > 0) {
    sessionOptions.additionalDirectories = options.additionalDirectories;
  }

  // CLI binary resolution
  // When CLAUDE_CLI_PATH is set, resolve and pass to SDK.
  // When empty/unset, let SDK use its own bundled CLI from node_modules.
  const customCliPath = process.env.CLAUDE_CLI_PATH?.trim();
  if (customCliPath) {
    const resolved = await resolveCliPath(customCliPath);
    if (!resolved) {
      logger.error(
        { sessionId, configured: customCliPath, event_type: EventType.SDK_CLI_MISSING },
        `CLAUDE_CLI_PATH "${customCliPath}" does not exist and no alternate Claude Code CLI found nearby`
      );
      throw new Error(`Claude Code CLI not found at ${customCliPath} or known alternate locations`);
    }
    sessionOptions.pathToClaudeCodeExecutable = resolved.path;
    let cliVersion = 'unknown';
    try {
      const path = await import('path');
      const fs = await import('fs/promises');
      for (const candidate of [path.dirname(resolved.path), path.join(path.dirname(resolved.path), '..')]) {
        try {
          const parsed = JSON.parse(await fs.readFile(path.join(candidate, 'package.json'), 'utf-8')) as unknown;
          const version = typeof parsed === 'object' && parsed !== null
            ? (parsed as Record<string, unknown>).version
            : undefined;
          if (typeof version === 'string' && version.length > 0) { cliVersion = version; break; }
        } catch { /* try next */ }
      }
    } catch { /* non-critical */ }
    if (resolved.fallback) {
      logger.warn(
        { sessionId, configured: customCliPath, resolved: resolved.path, cliVersion, event_type: EventType.SDK_CLI_RESOLVED },
        `CLAUDE_CLI_PATH "${customCliPath}" missing; resolved to ${resolved.path} (v${cliVersion})`
      );
    } else {
      logger.info(
        { sessionId, cliPath: resolved.path, cliVersion, event_type: EventType.SDK_CLI_OVERRIDE },
        `Using externally-installed Claude Code CLI v${cliVersion} (CLAUDE_CLI_PATH set)`
      );
    }
  } else {
    logger.info(
      { sessionId, event_type: EventType.SDK_CLI_BUNDLED },
      'Using SDK-bundled Claude Code CLI (CLAUDE_CLI_PATH unset)'
    );
  }

  // System prompt
  if (options.systemPrompt) {
    sessionOptions.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
      append: options.systemPrompt,
    };
  } else {
    sessionOptions.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
    };
  }

  // MCP servers
  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    sessionOptions.mcpServers = options.mcpServers;
    if (options.allowedTools) {
      sessionOptions.allowedTools = options.allowedTools;
    }
  }

  // Max turns
  if (options.maxTurns !== undefined) {
    sessionOptions.maxTurns = options.maxTurns;
  }

  // Thinking config
  const model = (agent.config.model ?? '').toLowerCase();
  const supportsAdaptiveThinking =
    model.includes('opus') || model.includes('sonnet') || model.includes('haiku');
  if (supportsAdaptiveThinking) {
    sessionOptions.thinking = { type: 'adaptive' } as { type: string };
  }

  // canUseTool
  if (options.additionalOptions?.canUseTool !== undefined) {
    sessionOptions.canUseTool = options.additionalOptions.canUseTool;
  }

  // Build a temporary managed object so hook closures can reference it.
  // The object is fully constructed below; hooks capture it by reference.
  const managed: ManagedSession = {
    // session is set after SDK call below ??use a placeholder until then
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

  // Hooks ??closures over `managed` (session-scoped mutable state)
  sessionOptions.hooks = {
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
            hooks: [async (input: unknown) => {
              const agentContext = extractHookAgentContext(input);
              if (agentContext.isSubagent) return { continue: true };
              logger.warn(
                {
                  sessionId,
                  event_type: EventType.CONTEXT_ECONOMY_BLOCK,
                  toolName,
                },
                'Context economy denied main-context web tool'
              );
              return createPreToolDeny(
                `Main-context ${toolName} is blocked by Context Economy. Delegate broad web/source discovery to Agent with subagent_type="scout".`,
              );
            }],
          }))
        : []),
    ],
    PreCompact: [{
      matcher: '',
      hooks: [async (input: unknown) => {
        const currentOptions = managed.currentOptions ?? options;
        const { trigger } = input as { trigger?: string };
        logger.info(
          { sessionId, event_type: EventType.SDK_HOOK_CB_PRE_COMPACT, trigger, keepalive: managed.isKeepalivePing === true },
          'V2 callback hook fired: PreCompact'
        );
        if (managed.isKeepalivePing === true) {
          return { continue: true };
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
          } catch { /* non-fatal */ }
        }
        return { continue: true };
      }],
    }],
  };

  // Create or resume the SDK session
  let session: ManagedSession['session'];
  if (resumeSessionId) {
    // Layer 2: detect incomplete JSONL tail before resume
    try {
      const { inspectJsonlTailIntegrity } = await import('../keepalive/SDKTranscriptDiagnostics.js');
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
          `JSONL tail incomplete on resume ??last stable end_turn at line ${tail.lastStableAssistantLine ?? 'none'}, tail is ${tail.tailType}/${tail.tailSubtype ?? '-'} at line ${tail.tailLine}`
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
