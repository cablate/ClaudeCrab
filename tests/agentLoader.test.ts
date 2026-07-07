import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentLoader } from '../src/core/orchestrator/AgentLoader.ts';

const tempRoots: string[] = [];

async function createTempAgentsDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'claudecab-agent-loader-'));
  tempRoots.push(root);
  return root;
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

describe('AgentLoader', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('scans only root-level enabled directories that contain agent.json', async () => {
    const agentsDir = await createTempAgentsDir();
    await writeJson(path.join(agentsDir, 'coder', 'agent.json'), { name: 'Coder' });
    await writeJson(path.join(agentsDir, 'general', 'agent.json'), { name: 'General' });
    await writeJson(path.join(agentsDir, '_disabled', 'agent.json'), { name: 'Disabled' });
    await writeJson(path.join(agentsDir, '_template', 'agent.json'), { name: 'Template' });
    await writeJson(path.join(agentsDir, 'example', 'nested', 'agent.json'), { name: 'Nested Example' });
    await mkdir(path.join(agentsDir, 'scratch'), { recursive: true });
    await mkdir(path.join(agentsDir, 'node_modules', 'package'), { recursive: true });

    const loader = new AgentLoader({ agentsDir });

    await expect(loader.scanAgents()).resolves.toEqual(['coder', 'general']);
  });

  it('loads MCP config without mirroring .claude/settings.local.json into agent.json config', async () => {
    const agentsDir = await createTempAgentsDir();
    const agentDir = path.join(agentsDir, 'coder');
    await writeJson(path.join(agentDir, 'agent.json'), { name: 'Coder' });
    await writeJson(path.join(agentDir, '.claude', 'settings.local.json'), { model: 'opus' });
    await writeJson(path.join(agentDir, '.mcp.json'), {
      mcpServers: {
        local: {
          command: 'node',
          args: ['server.js'],
          env: { EXAMPLE: '1' },
          transport: 'stdio',
        },
        invalid: 'not-an-object',
      },
    });

    const loader = new AgentLoader({ agentsDir });
    const agent = await loader.loadAgent('coder');

    expect(agent.id).toBe('coder');
    expect(agent.config).not.toHaveProperty('model');
    expect(agent.mcpServers).toEqual({
      local: {
        command: 'node',
        args: ['server.js'],
        env: { EXAMPLE: '1' },
        transport: 'stdio',
      },
    });
  });
});
