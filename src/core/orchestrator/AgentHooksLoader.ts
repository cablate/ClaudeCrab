import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AgentConfigError, AgentLoadError } from '../../types/errors.js';
import { type AgentHooks, HOOK_EVENT_NAMES } from '../../types/hooks.js';
import { logger } from '../../utils/logger.js';

const HOOKS_FILE = 'hooks.ts';
const HOOKS_FILE_JS = 'hooks.js';

export async function loadAgentHooks(agentPath: string, agentId: string): Promise<AgentHooks | undefined> {
  const hooksPath = await findHooksFile(agentPath, agentId);
  if (hooksPath === undefined) return undefined;

  try {
    const fileUrl = pathToFileURL(hooksPath).href;
    const module = (await import(`${fileUrl}?t=${Date.now()}`)) as Record<string, unknown>;
    const hooks = validateHooksExport(module, agentId);

    logger.info(
      { agentId, hookCount: Object.keys(hooks).length },
      'Hooks loaded'
    );

    return hooks;
  } catch (error) {
    throw new AgentLoadError(
      agentId,
      new Error(`Failed to load hooks: ${(error as Error).message}`)
    );
  }
}

async function findHooksFile(agentPath: string, agentId: string): Promise<string | undefined> {
  const jsPath = path.join(agentPath, HOOKS_FILE_JS);
  const tsPath = path.join(agentPath, HOOKS_FILE);

  try {
    await fs.access(jsPath);
    return jsPath;
  } catch {
    try {
      await fs.access(tsPath);
      return tsPath;
    } catch {
      logger.debug({ agentId }, 'No hooks file found');
      return undefined;
    }
  }
}

function validateHooksExport(module: Record<string, unknown>, agentId: string): AgentHooks {
  const hooks: AgentHooks = {};
  const validHookNames = new Set<string>(HOOK_EVENT_NAMES);

  for (const [key, value] of Object.entries(module)) {
    if (key === 'default') {
      if (typeof value === 'object' && value !== null) {
        return validateHooksExport(value as Record<string, unknown>, agentId);
      }
      continue;
    }

    if (validHookNames.has(key)) {
      if (typeof value !== 'function') {
        throw new AgentConfigError(agentId, [
          `Hook "${key}" must be a function, got ${typeof value}`,
        ]);
      }
      Object.assign(hooks, { [key]: value });
    } else {
      logger.warn(
        { agentId, hookName: key },
        'Unknown hook name in hooks file, ignoring'
      );
    }
  }

  return hooks;
}
