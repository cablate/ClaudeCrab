/**
 * SDKSessionFactory — creates and initialises ManagedSession objects.
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
import type { LoadedAgent, Model } from '../types/agent.js';
import { ConfigTransformer } from './ConfigTransformer.js';
import { projectHash } from './JsonlSanitizer.js';
import type { ExecuteQueryOptions } from './SDKQueryManager.js';
import { logger } from '../utils/logger.js';
import { EventType } from '../utils/events.js';
import { resolveCliPath } from '../utils/cliPath.js';
import { HOOK_DEFS } from './hooks/definitions.js';
import { readHookPrompt } from './hooks/promptLoader.js';
import { loadFoundationSubagents } from './subagents/foundationSubagents.js';
import { extractBashToolResponseText, extractHookAgentContext, extractHookAgentToolSubagentType, extractHookErrorText, extractHookReadInput, extractHookToolInput, extractToolResponseTextStats, isHookInterrupt } from './hooks/payload.js';
import { evaluateHardBlockToolUse } from './governance/hardBlocks.js';
import {
  buildGovernanceTouchMessage,
  createGovernanceSessionState,
  extractToolTargetPaths,
  getTotalExplorationToolCount,
  getTotalSubagentExplorationToolCount,
  recordBashCommand,
  recordCommandFailure,
  recordExplorationOutputSize,
  recordExplorationTool,
  recordPathTouch,
  recordScoutDelegation,
  recordSubagentExplorationOutputSize,
  recordSubagentExplorationTool,
} from './governance/telemetry.js';
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
    // file missing or invalid JSON — fall through to empty env
  }
  return {};
}

function createPreToolAdditionalContext(additionalContext: string) {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse' as const,
      additionalContext,
    },
  };
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

function getRegisteredSubagentModel(
  sessionOptions: ExtendedSessionOptions,
  subagentType: string,
): string {
  const model = sessionOptions.agents?.[subagentType]?.model;
  return typeof model === 'string' && model.length > 0 ? model : 'inherit';
}

type RequestedModelClass = 'none' | 'haiku' | 'expensive' | 'unknown';

function classifyRequestedModel(model: string | undefined): RequestedModelClass {
  if (model === undefined) return 'none';
  const normalized = model.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (normalized.includes('opus') || normalized.includes('sonnet')) return 'expensive';
  if (normalized.includes('haiku')) return 'haiku';
  return 'unknown';
}

function shouldAllowSubagentDelegation(requestedModel: string | undefined): boolean {
  return classifyRequestedModel(requestedModel) === 'haiku';
}

function createSubagentContextEconomyReminder(message: string): string {
  return [
    '<context-economy-warning>',
    message,
    'You are over the scout tool budget. Stop broad exploration and return a partial Scout Brief with Unverified items instead of continuing to search.',
    'Scout Brief fields: Question, Draft understanding, Source map, Use first, Risky claims, Contradictions, Do not rely on, Unverified.',
    '</context-economy-warning>',
  ].join('\n');
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
 * @param sessionId     — ClaudeCab conversation ID (for logging / hook closures)
 * @param agent         — Loaded agent config
 * @param options       — ExecuteQueryOptions forwarded from executeQuery
 * @param onCreated     — Called synchronously after ManagedSession is constructed so
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
    // session is set after SDK call below — use a placeholder until then
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
    governance: createGovernanceSessionState(),
  };

  // Hooks — closures over `managed` (session-scoped mutable state)
  const emitGovernanceVisibility = async (message: string, key?: string): Promise<void> => {
    if (managed.isKeepalivePing === true) return;
    if (key) {
      if (managed.governance.visibleEventKeys.has(key)) return;
      managed.governance.visibleEventKeys.add(key);
    }

    const currentOptions = managed.currentOptions ?? options;
    if (!currentOptions.onHookEvent) return;

    try {
      await currentOptions.onHookEvent({
        kind: 'governance',
        lifecycle: 'fired',
        correlationKey: `${sessionId}:gov:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        name: 'Governance',
        message,
      });
    } catch { /* non-fatal */ }
  };

  const emitPreToolUseVisibility = async (toolName: string, message: string): Promise<void> => {
    if (managed.isKeepalivePing === true) return;

    const currentOptions = managed.currentOptions ?? options;
    if (!currentOptions.onHookEvent) return;

    try {
      await currentOptions.onHookEvent({
        kind: 'pre_tool_use',
        lifecycle: 'fired',
        correlationKey: `${sessionId}:ptu:${toolName}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        name: `PreToolUse/${toolName}`,
        message,
      });
    } catch { /* non-fatal */ }
  };

  const maybeDenyHardBlock = async (
    toolName: string,
    toolInput: Record<string, unknown> | undefined,
  ): Promise<ReturnType<typeof createPreToolDeny> | undefined> => {
    const decision = evaluateHardBlockToolUse(
      toolName,
      toolInput,
      options.cwd,
      HOOK_DEFS.hardBlocks,
    );
    if (decision === undefined) return undefined;

    await emitGovernanceVisibility(
      `hard block: ${decision.reason}`,
      `hard-block:${decision.ruleId}:${decision.target ?? 'command'}`,
    );
    logger.warn(
      {
        sessionId,
        event_type: EventType.GOVERNANCE_HARD_BLOCK,
        toolName,
        ruleId: decision.ruleId,
        target: decision.target,
      },
      'Governance hard block denied tool use'
    );
    return createPreToolDeny(decision.reason);
  };

  sessionOptions.hooks = {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [async (input: unknown) => {
          const toolInput = extractHookToolInput(input);
          const hardBlock = await maybeDenyHardBlock('Bash', toolInput);
          if (hardBlock !== undefined) return hardBlock;

          const command = typeof toolInput?.command === 'string' ? toolInput.command : '';
          const result = command.length > 0
            ? recordBashCommand(managed.governance, command)
            : { validatorObserved: false, broadSearch: false };
          if (result.validatorObserved) {
            await emitGovernanceVisibility('validator observed', 'validator-observed');
            logger.info(
              {
                sessionId,
                event_type: EventType.GOVERNANCE_VALIDATOR_OBSERVED,
              },
              'Governance telemetry: validator command observed'
            );
          }
          if (result.broadSearch) {
            await emitGovernanceVisibility('broad search observed', 'broad-search');
            logger.info(
              {
                sessionId,
                event_type: EventType.GOVERNANCE_BROAD_SEARCH,
                count: managed.governance.broadSearchCount,
              },
              'Governance telemetry: broad search observed'
            );
          }
          return { continue: true };
        }],
      },
      ...Object.keys(HOOK_DEFS.contextEconomy.explorationToolThresholds).map((toolName) => ({
        matcher: toolName,
        hooks: [async (input: unknown) => {
          const agentContext = extractHookAgentContext(input);
          if (agentContext.isSubagent) {
            const count = recordSubagentExplorationTool(managed.governance, toolName);
            const totalSubagentExplorationCount = getTotalSubagentExplorationToolCount(managed.governance);
            let aiReminder: string | undefined;
            if (totalSubagentExplorationCount === HOOK_DEFS.contextEconomy.repeatedExplorationThreshold) {
              const message = `${HOOK_DEFS.contextEconomy.subagentRepeatedExplorationMessage}: tools=${totalSubagentExplorationCount}`;
              await emitGovernanceVisibility(
                message,
                'context-economy:subagent-repeated-exploration',
              );
              aiReminder = createSubagentContextEconomyReminder(message);
            }
            logger.info(
              {
                sessionId,
                event_type: EventType.GOVERNANCE_HIGH_COST_EXPLORATION,
                scope: 'subagent',
                toolName,
                count,
                agentId: agentContext.agentId,
                agentType: agentContext.agentType,
              },
              'Governance telemetry: subagent exploration observed'
            );
            if (aiReminder !== undefined) {
              return createPreToolAdditionalContext(aiReminder);
            }
            return { continue: true };
          }

          if (toolName === 'Read') {
            const largeReadPreflight = await evaluateLargeReadPreflight(input, options.cwd);
            if (largeReadPreflight !== undefined) {
              await emitGovernanceVisibility(
                largeReadPreflight.message,
                'context-economy:large-read-preflight',
              );
              logger.warn(
                {
                  sessionId,
                  event_type: EventType.GOVERNANCE_HARD_BLOCK,
                  toolName,
                  reason: largeReadPreflight.reason,
                },
                'Governance context-economy denied large unbounded Read'
              );
              return createPreToolDeny(largeReadPreflight.reason);
            }
          }

          const mainContextBlockedTools = HOOK_DEFS.contextEconomy.mainContextBlockedTools;
          if (mainContextBlockedTools.enabled && mainContextBlockedTools.tools.includes(toolName)) {
            const count = recordExplorationTool(managed.governance, toolName);
            const message = `${mainContextBlockedTools.message}: ${toolName}=${count}`;
            await emitGovernanceVisibility(
              message,
              `context-economy:block-main-tool:${toolName}`,
            );
            logger.warn(
              {
                sessionId,
                event_type: EventType.GOVERNANCE_HARD_BLOCK,
                toolName,
                count,
              },
              'Governance context-economy denied main-context web tool'
            );
            return createPreToolDeny(
              `Main-context ${toolName} is blocked by Context Economy. Delegate broad web/source discovery to Agent with subagent_type="scout".`,
            );
          }

          const count = recordExplorationTool(managed.governance, toolName);
          if (managed.governance.scoutDelegationCount > 0) {
            const message = `${HOOK_DEFS.contextEconomy.postScoutMainExplorationMessage}: ${toolName}=${count}`;
            await emitGovernanceVisibility(
              message,
              'context-economy:post-scout-main-exploration',
            );
          }
          const threshold = HOOK_DEFS.contextEconomy.explorationToolThresholds[toolName] ?? Number.POSITIVE_INFINITY;
          if (count === threshold) {
            const message = `${HOOK_DEFS.contextEconomy.warningMessage}: ${toolName}=${count}`;
            await emitGovernanceVisibility(
              message,
              `context-economy:${toolName}`,
            );
            logger.info(
              {
                sessionId,
                event_type: EventType.GOVERNANCE_HIGH_COST_EXPLORATION,
                toolName,
                count,
                threshold,
              },
              'Governance telemetry: high-cost main-context exploration observed'
            );
          }
          const totalExplorationCount = getTotalExplorationToolCount(managed.governance);
          if (totalExplorationCount === HOOK_DEFS.contextEconomy.repeatedExplorationThreshold) {
            const message = `${HOOK_DEFS.contextEconomy.repeatedExplorationMessage}: tools=${totalExplorationCount}`;
            await emitGovernanceVisibility(
              message,
              'context-economy:repeated-exploration',
            );
            logger.info(
              {
                sessionId,
                event_type: EventType.GOVERNANCE_HIGH_COST_EXPLORATION,
                toolName,
                totalExplorationCount,
                threshold: HOOK_DEFS.contextEconomy.repeatedExplorationThreshold,
              },
              'Governance telemetry: repeated main-context exploration observed'
            );
          }
          return { continue: true };
        }],
      })),
      ...HOOK_DEFS.contextEconomy.scoutToolMatchers.map((toolName) => ({
        matcher: toolName,
        hooks: [async (input: unknown) => {
          const agentContext = extractHookAgentContext(input);
          if (agentContext.isSubagent) {
            await emitPreToolUseVisibility(
              toolName,
              `nested ignored agent_type=${agentContext.agentType ?? '(unknown)'}`,
            );
            logger.info(
              {
                sessionId,
                event_type: EventType.GOVERNANCE_SCOUT_DELEGATION,
                scope: 'subagent',
                toolName,
                agentId: agentContext.agentId,
                agentType: agentContext.agentType,
              },
              'Governance telemetry: nested scout delegation ignored for main scout count'
            );
            return { continue: true };
          }

          const toolInput = extractHookToolInput(input);
          const subagentType = extractHookAgentToolSubagentType(input);
          const requestedModel = typeof toolInput?.model === 'string' && toolInput.model.trim().length > 0
            ? toolInput.model.trim()
            : undefined;
          const requestedModelDisplay = requestedModel ?? '(none)';
          const actualType = subagentType.length > 0 ? subagentType : '(missing)';

          if (!shouldAllowSubagentDelegation(requestedModel)) {
            const message = `subagent delegation blocked -> use Haiku model: subagent_type=${actualType} model=${requestedModelDisplay}`;
            await emitPreToolUseVisibility(toolName, `denied subagent_type=${actualType} model=${requestedModelDisplay}`);
            await emitGovernanceVisibility(
              message,
              `context-economy:subagent-model:${actualType}:${requestedModelDisplay}`,
            );
            return createPreToolDeny(
              'BLOCKED: model must be "haiku". Retry the same Agent call with model: "haiku" — do NOT skip the subagent.',
            );
          }

          if (subagentType === 'scout') {
            const registeredModel = getRegisteredSubagentModel(sessionOptions, subagentType);
            const count = recordScoutDelegation(managed.governance);
            await emitGovernanceVisibility(
              HOOK_DEFS.contextEconomy.scoutMessage,
              'context-economy:scout',
            );
            logger.info(
              {
                sessionId,
                event_type: EventType.GOVERNANCE_SCOUT_DELEGATION,
                toolName,
                count,
                subagentType,
                registeredModel,
                requestedModel,
              },
              'Governance telemetry: scout delegation observed'
            );
          } else {
            logger.info(
              {
                sessionId,
                event_type: EventType.GOVERNANCE_SCOUT_DELEGATION,
                toolName,
                subagentType: subagentType || undefined,
              },
              'Governance telemetry: generic subagent delegation allowed'
            );
          }
          return { continue: true };
        }],
      })),
      ...['Write', 'Edit', 'MultiEdit'].map((toolName) => ({
        matcher: toolName,
        hooks: [async (input: unknown) => {
          const toolInput = extractHookToolInput(input);
          const hardBlock = await maybeDenyHardBlock(toolName, toolInput);
          if (hardBlock !== undefined) return hardBlock;

          if (toolInput !== undefined) {
            for (const targetPath of extractToolTargetPaths(toolName, toolInput)) {
              const classification = recordPathTouch(managed.governance, targetPath);
              if (classification.governed) {
                await emitGovernanceVisibility(
                  buildGovernanceTouchMessage(classification),
                  `touch:${classification.category}`,
                );
                logger.info(
                  {
                    sessionId,
                    event_type: EventType.GOVERNANCE_GOVERNED_FILE_CHANGED,
                    category: classification.category,
                    path: classification.normalizedPath,
                    recommendedCheck: classification.recommendedCheck,
                  },
                  'Governance telemetry: governed file touch observed'
                );
              }
              if (classification.validatorRelevant) {
                logger.info(
                  {
                    sessionId,
                    event_type: EventType.GOVERNANCE_VALIDATOR_NEEDED,
                    category: classification.category,
                    path: classification.normalizedPath,
                  },
                  'Governance telemetry: validator needed'
                );
              }
              if (classification.category === 'archive') {
                logger.info(
                  {
                    sessionId,
                    event_type: EventType.GOVERNANCE_ARCHIVE_PATH_ACCESS,
                    path: classification.normalizedPath,
                    count: managed.governance.archiveAccessCount,
                  },
                  'Governance telemetry: archive path accessed'
                );
              }
            }
          }
          return { continue: true };
        }],
      })),
    ],
    PostToolUse: [{
      matcher: 'Bash',
      hooks: [async (input: unknown) => {
        const toolOutput = extractBashToolResponseText(input);
        logger.debug(
          {
            sessionId,
            event_type: EventType.SDK_HOOK_CB_POST_TOOL_USE,
            hasToolResponse: toolOutput.hasToolResponse,
            stdoutLen: toolOutput.stdout.length,
            stderrLen: toolOutput.stderr.length,
            outputLen: toolOutput.combined.length,
          },
          'V2 callback hook fired: PostToolUse/Bash'
        );
        try {
          if (!toolOutput.combined) return { continue: true };

          const def = HOOK_DEFS.postToolUseBash;
          const hasError = def.errorPatterns.some(p => p.test(toolOutput.combined));
          if (hasError) {
          recordCommandFailure(managed.governance);
          await emitGovernanceVisibility('command failure observed -> resolve before PASS', 'command-failure');
          logger.info(
              {
                sessionId,
                event_type: EventType.GOVERNANCE_COMMAND_FAILURE,
                count: managed.governance.commandFailureCount,
              },
              'Governance telemetry: command failure observed'
            );
            return {
              continue: true,
              hookSpecificOutput: {
                additionalContext: readHookPrompt(def.promptId),
              },
            };
          }
          return { continue: true };
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'PostToolUse hook failed');
          return { continue: true };
        }
      }],
    },
    ...Object.keys(HOOK_DEFS.contextEconomy.outputCharThresholds).map((toolName) => ({
      matcher: toolName,
      hooks: [async (input: unknown) => {
        const stats = extractToolResponseTextStats(input);
        const agentContext = extractHookAgentContext(input);
        logger.debug(
          {
            sessionId,
            event_type: EventType.SDK_HOOK_CB_POST_TOOL_USE,
            toolName,
            scope: agentContext.isSubagent ? 'subagent' : 'main',
            hasToolResponse: stats.hasToolResponse,
            charCount: stats.charCount,
          },
          'V2 callback hook fired: PostToolUse/context-economy'
        );
        if (!stats.hasToolResponse || stats.charCount <= 0) return { continue: true };

        if (agentContext.isSubagent) {
          const result = recordSubagentExplorationOutputSize(managed.governance, toolName, stats.charCount);
          logger.info(
            {
              sessionId,
              event_type: EventType.GOVERNANCE_LARGE_READ,
              scope: 'subagent',
              toolName,
              charCount: stats.charCount,
              totalChars: result.totalChars,
              agentId: agentContext.agentId,
              agentType: agentContext.agentType,
            },
            'Governance telemetry: subagent exploration output observed'
          );
          return { continue: true };
        }

        const threshold = HOOK_DEFS.contextEconomy.outputCharThresholds[toolName] ?? Number.POSITIVE_INFINITY;
        const result = recordExplorationOutputSize(managed.governance, toolName, stats.charCount, threshold);
        if (result.large) {
          await emitGovernanceVisibility(
            `${HOOK_DEFS.contextEconomy.largeOutputMessage}: ${toolName}=${stats.charCount}ch`,
            `context-economy:large-output:${toolName}:${result.largeCount}`,
          );
          logger.info(
            {
              sessionId,
              event_type: EventType.GOVERNANCE_LARGE_READ,
              toolName,
              charCount: stats.charCount,
              totalChars: result.totalChars,
              threshold,
            },
            'Governance telemetry: large exploration output observed'
          );
        }
        return { continue: true };
      }],
    }))],
    PostToolUseFailure: [{
      matcher: 'Bash',
      hooks: [async (input: unknown) => {
        const errorText = extractHookErrorText(input);
        const interrupted = isHookInterrupt(input);
        logger.debug(
          {
            sessionId,
            event_type: EventType.SDK_HOOK_CB_POST_TOOL_USE_FAILURE,
            errorLen: errorText.length,
            interrupted,
          },
          'V2 callback hook fired: PostToolUseFailure/Bash'
        );
        try {
          if (interrupted) return { continue: true };

          recordCommandFailure(managed.governance);
          await emitGovernanceVisibility('command failure observed -> resolve before PASS', 'command-failure');
          logger.info(
            {
              sessionId,
              event_type: EventType.GOVERNANCE_COMMAND_FAILURE,
              count: managed.governance.commandFailureCount,
            },
            'Governance telemetry: command failure observed'
          );

          const def = HOOK_DEFS.postToolUseBash;
          return {
            continue: true,
            hookSpecificOutput: {
              additionalContext: readHookPrompt(def.promptId),
            },
          };
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'PostToolUseFailure hook failed');
          return { continue: true };
        }
      }],
    }],
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
      const { inspectJsonlTailIntegrity } = await import('./SDKTranscriptDiagnostics.js');
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
          `JSONL tail incomplete on resume — last stable end_turn at line ${tail.lastStableAssistantLine ?? 'none'}, tail is ${tail.tailType}/${tail.tailSubtype ?? '-'} at line ${tail.tailLine}`
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
