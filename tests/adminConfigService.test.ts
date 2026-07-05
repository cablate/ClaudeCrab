import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AdminConfigService } from '../src/admin/AdminConfigService.ts';

const tempRoots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'claudecab-admin-'));
  tempRoots.push(root);
  await mkdir(path.join(root, 'agents', 'example', '.claude'), { recursive: true });
  await writeFile(path.join(root, 'agents', 'example', 'agent.json'), JSON.stringify({
    name: 'Example',
    model: 'sonnet',
    discordBotToken: 'old-agent-token',
    discordChannelId: '123456789012345678',
  }, null, 2), 'utf-8');
  await writeFile(path.join(root, 'agents', 'example', '.claude', 'settings.local.json'), JSON.stringify({
    model: 'sonnet',
    env: {
      ANTHROPIC_API_KEY: 'old-key',
    },
  }, null, 2), 'utf-8');
  return root;
}

describe('AdminConfigService', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('writes allowlisted global config to local overlay and masks secrets', async () => {
    const root = await createRoot();
    const localConfigPath = path.join(root, 'data', 'claudecab.local.json');
    const service = new AdminConfigService({
      cwd: root,
      agentsDir: path.join(root, 'agents'),
      localConfigPath,
    });

    const result = await service.updateGlobal({
      values: {
        DISCORD_MAIN_BOT_TOKEN: 'secret-token',
        ADMIN_CONSOLE_PORT: 47824,
      },
    });
    const saved = JSON.parse(await readFile(localConfigPath, 'utf-8')) as Record<string, unknown>;
    const snapshot = await service.getSnapshot();
    const tokenField = snapshot.global.find((field) => field.key === 'DISCORD_MAIN_BOT_TOKEN');

    expect(result.restartRequired).toBe(true);
    expect(saved.DISCORD_MAIN_BOT_TOKEN).toBe('secret-token');
    expect(saved.ADMIN_CONSOLE_PORT).toBe(47824);
    expect(tokenField?.value).toBe('********');
    expect(tokenField?.set).toBe(true);
  });

  it('rejects unknown global fields', async () => {
    const root = await createRoot();
    const service = new AdminConfigService({
      cwd: root,
      agentsDir: path.join(root, 'agents'),
      localConfigPath: path.join(root, 'data', 'claudecab.local.json'),
    });

    await expect(service.updateGlobal({ values: { UNKNOWN: 'x' } })).rejects.toThrow('Field is not editable');
  });

  it('updates agent json and settings.local.json through allowlisted fields', async () => {
    const root = await createRoot();
    const service = new AdminConfigService({
      cwd: root,
      agentsDir: path.join(root, 'agents'),
      localConfigPath: path.join(root, 'data', 'claudecab.local.json'),
    });

    const result = await service.updateAgent('example', {
      agent: {
        name: 'Updated',
        model: 'opus',
      },
      settings: {
        model: 'haiku',
      },
      providerEnv: {
        ANTHROPIC_BASE_URL: 'https://provider.example.com',
        ANTHROPIC_API_KEY: 'agent-secret',
      },
    });

    const agent = JSON.parse(await readFile(path.join(root, 'agents', 'example', 'agent.json'), 'utf-8')) as Record<string, unknown>;
    const settings = JSON.parse(await readFile(path.join(root, 'agents', 'example', '.claude', 'settings.local.json'), 'utf-8')) as {
      model?: unknown;
      env?: Record<string, unknown>;
    };

    expect(result.sessionCloseRecommended).toBe(true);
    expect(agent.name).toBe('Updated');
    expect(agent.model).toBe('opus');
    expect(settings.model).toBe('haiku');
    expect(settings.env?.ANTHROPIC_BASE_URL).toBe('https://provider.example.com');
    expect(settings.env?.ANTHROPIC_API_KEY).toBe('agent-secret');
  });

  it('rejects agent path traversal', async () => {
    const root = await createRoot();
    const service = new AdminConfigService({
      cwd: root,
      agentsDir: path.join(root, 'agents'),
      localConfigPath: path.join(root, 'data', 'claudecab.local.json'),
    });

    await expect(service.updateAgent('../outside', { agent: { name: 'bad' } })).rejects.toThrow('Invalid agent id');
  });
});
