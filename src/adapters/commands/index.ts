import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentLoader } from '../../core/orchestrator/AgentLoader.js';

export async function applyModelChange(
  agentId: string,
  model: string,
  agentLoader: AgentLoader
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
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  await agentLoader.loadAgent(agentId);

  return { success: true };
}
