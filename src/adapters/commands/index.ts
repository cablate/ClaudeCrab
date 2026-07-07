import fs from 'node:fs/promises';
import path from 'node:path';
import type { LoadedAgent } from '../../types/agent.js';
import type { AgentLoader } from '../../core/orchestrator/AgentLoader.js';

export async function readAgentRuntimeModel(agent: LoadedAgent): Promise<string | undefined> {
  const settingsPath = path.join(agent.path, '.claude', 'settings.local.json');
  try {
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Record<string, unknown>;
    return typeof settings.model === 'string' && settings.model.trim().length > 0
      ? settings.model
      : undefined;
  } catch {
    return undefined;
  }
}

export async function applyModelChange(
  agentId: string,
  model: string,
  agentLoader: AgentLoader,
): Promise<{ success: boolean; error?: string }> {
  const agent = agentLoader.get(agentId);
  if (agent === undefined) {
    return { success: false, error: 'Agent not found' };
  }

  const settingsDir = path.join(agent.path, '.claude');
  const settingsPath = path.join(settingsDir, 'settings.local.json');
  let settings: Record<string, unknown> = {};

  try {
    const content = await fs.readFile(settingsPath, 'utf-8');
    settings = JSON.parse(content) as Record<string, unknown>;
  } catch {
    settings = {};
  }

  settings.model = model;
  await fs.mkdir(settingsDir, { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
  await agentLoader.loadAgent(agentId);

  return { success: true };
}
