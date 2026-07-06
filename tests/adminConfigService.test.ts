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
    model: 'deepseek-v4-flash[1m]',
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
        SCHEDULE_ENABLED: false,
      },
    });
    const saved = JSON.parse(await readFile(localConfigPath, 'utf-8')) as Record<string, unknown>;
    const snapshot = await service.getSnapshot();
    const tokenField = snapshot.global.find((field) => field.key === 'DISCORD_MAIN_BOT_TOKEN');

    expect(result.restartRequired).toBe(true);
    expect(saved.DISCORD_MAIN_BOT_TOKEN).toBe('secret-token');
    expect(saved.SCHEDULE_ENABLED).toBe(false);
    expect(tokenField?.value).toBe('********');
    expect(tokenField?.set).toBe(true);
    expect(tokenField?.help).toContain('主 Bot');
  });

  it('rejects unknown or internal global fields', async () => {
    const root = await createRoot();
    const service = new AdminConfigService({
      cwd: root,
      agentsDir: path.join(root, 'agents'),
      localConfigPath: path.join(root, 'data', 'claudecab.local.json'),
    });

    await expect(service.updateGlobal({ values: { UNKNOWN: 'x' } })).rejects.toThrow('Field is not editable');
    await expect(service.updateGlobal({ values: { DB_PATH: './other.db' } })).rejects.toThrow('Field is not editable');
    await expect(service.updateGlobal({ values: { SESSION_IDLE_CLOSE_MS: 1000 } })).rejects.toThrow('Field is not editable');
    await expect(service.updateGlobal({ values: { ADMIN_CONSOLE_PORT: 47825 } })).rejects.toThrow('Field is not editable');
  });

  it('resolves relative local config path from cwd', async () => {
    const root = await createRoot();
    const service = new AdminConfigService({
      cwd: root,
      agentsDir: 'agents',
      localConfigPath: 'data/claudecab.local.json',
    });

    await service.updateGlobal({
      values: {
        DISCORD_OWNER_USER_ID: '123456789012345678',
      },
    });

    const saved = JSON.parse(await readFile(path.join(root, 'data', 'claudecab.local.json'), 'utf-8')) as Record<string, unknown>;
    expect(saved.DISCORD_OWNER_USER_ID).toBe('123456789012345678');
  });

  it('removes a local global override when a field is cleared', async () => {
    const root = await createRoot();
    const localConfigPath = path.join(root, 'data', 'claudecab.local.json');
    await mkdir(path.dirname(localConfigPath), { recursive: true });
    await writeFile(localConfigPath, JSON.stringify({
      SCHEDULE_ENABLED: true,
      DISCORD_OWNER_USER_ID: '123456789012345678',
    }, null, 2), 'utf-8');
    const service = new AdminConfigService({
      cwd: root,
      agentsDir: 'agents',
      localConfigPath,
    });

    const result = await service.updateGlobal({
      values: {
        SCHEDULE_ENABLED: null,
      },
    });

    const saved = JSON.parse(await readFile(localConfigPath, 'utf-8')) as Record<string, unknown>;
    expect(result.updated).toEqual(['SCHEDULE_ENABLED']);
    expect(result.restartRequired).toBe(true);
    expect(saved).not.toHaveProperty('SCHEDULE_ENABLED');
    expect(saved.DISCORD_OWNER_USER_ID).toBe('123456789012345678');
  });

  it('accepts JSON files with a UTF-8 BOM', async () => {
    const root = await createRoot();
    const agentPath = path.join(root, 'agents', 'example', 'agent.json');
    const current = await readFile(agentPath, 'utf-8');
    await writeFile(agentPath, `\uFEFF${current}`, 'utf-8');
    const service = new AdminConfigService({
      cwd: root,
      agentsDir: 'agents',
      localConfigPath: 'data/claudecab.local.json',
    });

    const snapshot = await service.getSnapshot();
    expect(snapshot.agents[0]?.id).toBe('example');
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
      },
      settings: {
        model: 'glm-5.2[1m]',
      },
      providerEnv: {
        ANTHROPIC_BASE_URL: 'https://provider.example.com',
        ANTHROPIC_API_KEY: 'agent-secret',
        ANTHROPIC_AUTH_TOKEN: 'agent-auth-token',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.2[1m]',
        CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-flash[1m]',
      },
    });

    const agent = JSON.parse(await readFile(path.join(root, 'agents', 'example', 'agent.json'), 'utf-8')) as Record<string, unknown>;
    const settings = JSON.parse(await readFile(path.join(root, 'agents', 'example', '.claude', 'settings.local.json'), 'utf-8')) as {
      model?: unknown;
      env?: Record<string, unknown>;
    };

    expect(result.sessionCloseRecommended).toBe(true);
    expect(agent.name).toBe('Updated');
    expect(agent.model).toBe('sonnet');
    expect(settings.model).toBe('glm-5.2[1m]');
    expect(settings.env?.ANTHROPIC_BASE_URL).toBe('https://provider.example.com');
    expect(settings.env?.ANTHROPIC_API_KEY).toBe('agent-secret');
    expect(settings.env?.ANTHROPIC_AUTH_TOKEN).toBe('agent-auth-token');
    expect(settings.env?.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('glm-5.2[1m]');
    expect(settings.env?.CLAUDE_CODE_SUBAGENT_MODEL).toBe('deepseek-v4-flash[1m]');
  });

  it('rejects agent.json model edits because runtime model belongs to settings.local.json', async () => {
    const root = await createRoot();
    const service = new AdminConfigService({
      cwd: root,
      agentsDir: path.join(root, 'agents'),
      localConfigPath: path.join(root, 'data', 'claudecab.local.json'),
    });

    await expect(service.updateAgent('example', {
      agent: {
        model: 'opus',
      },
    })).rejects.toThrow('Field is not editable');
  });

  it('clears optional agent and settings.local.json fields by deleting keys', async () => {
    const root = await createRoot();
    const service = new AdminConfigService({
      cwd: root,
      agentsDir: path.join(root, 'agents'),
      localConfigPath: path.join(root, 'data', 'claudecab.local.json'),
    });

    const result = await service.updateAgent('example', {
      agent: {
        discordBotToken: null,
      },
      settings: {
        model: null,
      },
      providerEnv: {
        ANTHROPIC_API_KEY: null,
      },
    });

    const agent = JSON.parse(await readFile(path.join(root, 'agents', 'example', 'agent.json'), 'utf-8')) as Record<string, unknown>;
    const settings = JSON.parse(await readFile(path.join(root, 'agents', 'example', '.claude', 'settings.local.json'), 'utf-8')) as {
      model?: unknown;
      env?: Record<string, unknown>;
    };

    expect(result.updated).toEqual(['agent.discordBotToken', 'settings.model', 'settings.env.ANTHROPIC_API_KEY']);
    expect(agent).not.toHaveProperty('discordBotToken');
    expect(settings).not.toHaveProperty('model');
    expect(settings).not.toHaveProperty('env');
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
