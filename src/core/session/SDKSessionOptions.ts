import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LoadedAgent, Model } from '../../types/agent.js';
import { ConfigTransformer } from '../lib/ConfigTransformer.js';
import { projectHash } from '../lib/JsonlSanitizer.js';
import type { ExecuteQueryOptions } from '../query/types.js';
import { logger } from '../../utils/logger.js';
import { EventType } from '../../utils/events.js';
import { resolveCliPath } from '../../utils/cliPath.js';
import type { ExtendedSessionOptions } from './SDKSessionTypes.js';

const DEFAULT_MODEL_ENV_BY_ALIAS: Partial<Record<Model, string>> = {
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
};

export interface BuiltSessionOptions {
  sessionOptions: ExtendedSessionOptions;
  resumeSessionId: string | undefined;
}

interface AgentClaudeSettings {
  model?: string;
  env: Record<string, string>;
}

export async function buildSessionOptions(
  sessionId: string,
  agent: LoadedAgent,
  options: ExecuteQueryOptions,
): Promise<BuiltSessionOptions> {
  const settings = await loadAgentClaudeSettings(agent.path);
  const settingsEnv = settings.env;
  const wantsApiKeyAuth = typeof settingsEnv.ANTHROPIC_API_KEY === 'string' && settingsEnv.ANTHROPIC_API_KEY.length > 0;
  const wantsAgentConfigDir = wantsApiKeyAuth || (
    typeof settingsEnv.ANTHROPIC_AUTH_TOKEN === 'string'
    && settingsEnv.ANTHROPIC_AUTH_TOKEN.length > 0
    && typeof settingsEnv.ANTHROPIC_BASE_URL === 'string'
    && settingsEnv.ANTHROPIC_BASE_URL.length > 0
  );
  const redirectedConfigDir = wantsAgentConfigDir ? path.join(agent.path, '.claude') : undefined;
  const resumeSessionId = await resolveResumeSessionId(
    sessionId,
    options.resume,
    redirectedConfigDir,
    options.cwd ?? agent.path,
  );
  const modelResolver = (model: Model | string): string => resolveModelForSettings(model, settingsEnv);
  const requestedModel = options.model
    ?? options.additionalOptions?.model
    ?? settings.model
    ?? 'sonnet' as Model;

  const sessionOptions: ExtendedSessionOptions = {
    model: modelResolver(requestedModel),
    cwd: options.cwd,
    permissionMode: 'default',
    settingSources: options.settingSources ?? ['project', 'local'],
    env: {
      CLAUDE_CODE_REMOTE: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CODE_ENABLE_TASKS: '0',
      ...settingsEnv,
      ...(wantsAgentConfigDir
        ? {
            ...(wantsApiKeyAuth ? { ANTHROPIC_AUTH_TOKEN: '' } : {}),
            ...(redirectedConfigDir !== undefined ? { CLAUDE_CONFIG_DIR: redirectedConfigDir } : {}),
          }
        : {}),
    },
    includeHookEvents: true,
    agentProgressSummaries: true,
    forwardSubagentText: false,
  };

  if (options.additionalOptions?.agents !== undefined) {
    sessionOptions.agents = options.additionalOptions.agents;
  }

  const abortController = options.abortController ?? options.additionalOptions?.abortController;
  if (abortController !== undefined) {
    sessionOptions.abortController = abortController;
  }

  await applyCliPathOverride(sessionId, sessionOptions);

  sessionOptions.systemPrompt = options.systemPrompt
    ? { type: 'preset', preset: 'claude_code', append: options.systemPrompt }
    : { type: 'preset', preset: 'claude_code' };

  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    sessionOptions.mcpServers = options.mcpServers;
    if (options.allowedTools) {
      sessionOptions.allowedTools = options.allowedTools;
    }
  }

  if (options.maxTurns !== undefined) {
    sessionOptions.maxTurns = options.maxTurns;
  }

  const persistSession = options.persistSession ?? options.additionalOptions?.persistSession;
  if (persistSession !== undefined) {
    sessionOptions.persistSession = persistSession;
  }

  sessionOptions.thinking = { type: 'adaptive' } as { type: string };

  if (options.additionalOptions?.canUseTool !== undefined) {
    sessionOptions.canUseTool = options.additionalOptions.canUseTool;
  }

  return { sessionOptions, resumeSessionId };
}

function resolveModelForSettings(model: Model | string, settingsEnv: Record<string, string>): string {
  const defaultEnvKey = DEFAULT_MODEL_ENV_BY_ALIAS[model as Model];
  if (defaultEnvKey !== undefined) {
    const providerDefault = settingsEnv[defaultEnvKey]?.trim();
    if (providerDefault) return providerDefault;
  }
  return ConfigTransformer.resolveModel(model);
}

async function loadAgentClaudeSettings(agentPath: string): Promise<AgentClaudeSettings> {
  const settingsPath = path.join(agentPath, '.claude', 'settings.local.json');
  try {
    const content = await readFile(settingsPath, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const model = typeof parsed.model === 'string' && parsed.model.trim().length > 0
      ? parsed.model.trim()
      : undefined;
    const env = parsed.env;
    const out: Record<string, string> = {};
    if (env && typeof env === 'object' && !Array.isArray(env)) {
      for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
        if (typeof value === 'string') out[key] = value;
      }
    }
    return { ...(model !== undefined ? { model } : {}), env: out };
  } catch {
    // Missing or invalid local Claude settings are non-fatal.
  }
  return { env: {} };
}

async function resolveResumeSessionId(
  sessionId: string,
  requestedResume: string | undefined,
  redirectedConfigDir: string | undefined,
  cwd: string,
): Promise<string | undefined> {
  if (!requestedResume || !redirectedConfigDir) return requestedResume;

  const expectedJsonl = path.join(
    redirectedConfigDir,
    'projects',
    projectHash(cwd),
    `${requestedResume}.jsonl`,
  );
  try {
    await stat(expectedJsonl);
    return requestedResume;
  } catch {
    logger.info(
      { sessionId, sdkSessionId: requestedResume, expectedJsonl, event_type: 'session.resume_fresh_for_redirected_config' },
      'Resume target jsonl not in redirected CLAUDE_CONFIG_DIR; starting fresh SDK session',
    );
    return undefined;
  }
}

async function applyCliPathOverride(sessionId: string, sessionOptions: ExtendedSessionOptions): Promise<void> {
  const customCliPath = process.env.CLAUDE_CLI_PATH?.trim();
  if (!customCliPath) {
    logger.info(
      { sessionId, event_type: EventType.SDK_CLI_BUNDLED },
      'Using SDK-bundled Claude Code CLI (CLAUDE_CLI_PATH unset)'
    );
    return;
  }

  const resolved = await resolveCliPath(customCliPath);
  if (!resolved) {
    logger.error(
      { sessionId, configured: customCliPath, event_type: EventType.SDK_CLI_MISSING },
      `CLAUDE_CLI_PATH "${customCliPath}" is invalid and no fallback Claude Code CLI was found`
    );
    throw new Error(
      `Claude Code CLI override is invalid: ${customCliPath}. Clear CLAUDE_CLI_PATH to use the SDK-bundled CLI, or set it to a working Claude Code executable such as claude.cmd.`
    );
  }

  sessionOptions.pathToClaudeCodeExecutable = resolved.path;
  const cliVersion = await readCliVersion(resolved.path);
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
}

async function readCliVersion(cliPath: string): Promise<string> {
  try {
    const fs = await import('fs/promises');
    for (const candidate of [path.dirname(cliPath), path.join(path.dirname(cliPath), '..')]) {
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(candidate, 'package.json'), 'utf-8')) as unknown;
        const version = typeof parsed === 'object' && parsed !== null
          ? (parsed as Record<string, unknown>).version
          : undefined;
        if (typeof version === 'string' && version.length > 0) return version;
      } catch {
        logger.debug('CLI package.json version read failed; trying next candidate');
      }
    }
  } catch {
    // Best-effort version detection only.
  }
  return 'unknown';
}
