import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runSetupCheck } from '../scripts/setup-check.ts';

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'claudecab-setup-check-'));
  tempRoots.push(root);
  return root;
}

async function writeText(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeText(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeBaseProject(root: string, overrides: {
  env?: string;
  agent?: Record<string, unknown>;
  settings?: Record<string, unknown>;
} = {}): Promise<void> {
  await writeText(path.join(root, '.env.example'), [
    'DISCORD_ENABLED=true',
    'DISCORD_MAIN_BOT_TOKEN=',
    'DISCORD_MAIN_BOT_CLIENT_ID=',
    'DISCORD_GUILD_ID=',
    'AGENTS_DIR=./agents',
    'ANTHROPIC_API_KEY=',
    '',
  ].join('\n'));

  await writeText(path.join(root, '.env'), overrides.env ?? [
    'DISCORD_ENABLED=true',
    'DISCORD_MAIN_BOT_TOKEN=main.real.token',
    'DISCORD_MAIN_BOT_CLIENT_ID=123456789012345678',
    'DISCORD_GUILD_ID=223456789012345678',
    'AGENTS_DIR=./agents',
    'ANTHROPIC_API_KEY=sk-test',
    '',
  ].join('\n'));

  await writeJson(path.join(root, 'agents', 'example', 'agent.json'), {
    name: 'Example',
    model: 'sonnet',
    discordBotToken: 'agent.real.token',
    discordChannelId: '323456789012345678',
    ...(overrides.agent ?? {}),
  });
  await writeJson(path.join(root, 'agents', 'example', '.claude', 'settings.local.json'), overrides.settings ?? {
    model: 'sonnet',
    env: {},
  });
  await writeText(path.join(root, 'agents', 'example', 'CLAUDE.md'), '# Example\n');
}

describe('setup-check', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('accepts a minimal valid setup', async () => {
    const root = await createTempRoot();
    await writeBaseProject(root);

    const result = runSetupCheck({ cwd: root });

    expect(result.errorCount).toBe(0);
    expect(result.checks.some((check) => check.area === 'auth' && check.level === 'ok')).toBe(true);
  });

  it('allows placeholders in template mode', async () => {
    const root = await createTempRoot();
    await writeBaseProject(root, {
      agent: {
        discordBotToken: 'replace-with-agent-bot-token',
        discordChannelId: 'replace-with-discord-channel-id',
      },
    });

    const result = runSetupCheck({ cwd: root, args: ['--template'] });

    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBeGreaterThan(0);
  });

  it('rejects shared main bot and agent bot tokens', async () => {
    const root = await createTempRoot();
    await writeBaseProject(root, {
      agent: { discordBotToken: 'main.real.token' },
    });

    const result = runSetupCheck({ cwd: root });

    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.checks.some((check) => check.area === 'discord' && check.message.includes('equals agent discordBotToken'))).toBe(true);
  });

  it('rejects Discord IDs pasted into bot token fields', async () => {
    const root = await createTempRoot();
    await writeBaseProject(root, {
      env: [
        'DISCORD_ENABLED=true',
        'DISCORD_MAIN_BOT_TOKEN=123456789012345678',
        'DISCORD_MAIN_BOT_CLIENT_ID=223456789012345678',
        'DISCORD_GUILD_ID=323456789012345678',
        'AGENTS_DIR=./agents',
        'ANTHROPIC_API_KEY=sk-test',
        '',
      ].join('\n'),
      agent: { discordBotToken: '423456789012345678' },
    });

    const result = runSetupCheck({ cwd: root });

    expect(result.errorCount).toBeGreaterThanOrEqual(2);
    expect(result.checks.some((check) => check.message.includes('DISCORD_MAIN_BOT_TOKEN looks like a Discord ID'))).toBe(true);
    expect(result.checks.some((check) => check.message.includes('agent discordBotToken looks like a Discord ID'))).toBe(true);
  });

  it('rejects Discord ID fields that were mixed together', async () => {
    const root = await createTempRoot();
    await writeBaseProject(root, {
      env: [
        'DISCORD_ENABLED=true',
        'DISCORD_MAIN_BOT_TOKEN=main.real.token',
        'DISCORD_MAIN_BOT_CLIENT_ID=123456789012345678',
        'DISCORD_GUILD_ID=123456789012345678',
        'AGENTS_DIR=./agents',
        'ANTHROPIC_API_KEY=sk-test',
        '',
      ].join('\n'),
      agent: { discordChannelId: '123456789012345678' },
    });

    const result = runSetupCheck({ cwd: root });

    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.checks.some((check) => check.message.includes('Client ID is the application ID'))).toBe(true);
    expect(result.checks.some((check) => check.message.includes('Server ID and channel ID are different'))).toBe(true);
    expect(result.checks.some((check) => check.message.includes('Application ID and channel ID are different'))).toBe(true);
  });

  it('rejects OAuth-style config with base URL but no API key', async () => {
    const root = await createTempRoot();
    await writeBaseProject(root, {
      env: [
        'DISCORD_ENABLED=true',
        'DISCORD_MAIN_BOT_TOKEN=main.real.token',
        'DISCORD_MAIN_BOT_CLIENT_ID=123456789012345678',
        'DISCORD_GUILD_ID=223456789012345678',
        'AGENTS_DIR=./agents',
        'ANTHROPIC_API_KEY=',
        'ANTHROPIC_BASE_URL=https://proxy.example.com',
        '',
      ].join('\n'),
    });

    const result = runSetupCheck({ cwd: root });

    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.checks.some((check) => check.area === 'auth' && check.message.includes('OAuth mode'))).toBe(true);
  });

  it('accepts agent-level proxy credentials and reports config isolation', async () => {
    const root = await createTempRoot();
    await writeBaseProject(root, {
      env: [
        'DISCORD_ENABLED=true',
        'DISCORD_MAIN_BOT_TOKEN=main.real.token',
        'DISCORD_MAIN_BOT_CLIENT_ID=123456789012345678',
        'DISCORD_GUILD_ID=223456789012345678',
        'AGENTS_DIR=./agents',
        'ANTHROPIC_API_KEY=',
        '',
      ].join('\n'),
      settings: {
        model: 'sonnet',
        env: {
          ANTHROPIC_API_KEY: 'provider-key',
          ANTHROPIC_BASE_URL: 'https://proxy.example.com',
        },
      },
    });

    const result = runSetupCheck({ cwd: root });

    expect(result.errorCount).toBe(0);
    expect(result.checks.some((check) => check.area === 'auth' && check.message.includes('CLAUDE_CONFIG_DIR'))).toBe(true);
  });

  it('rejects agent-level proxy base URL without an API key', async () => {
    const root = await createTempRoot();
    await writeBaseProject(root, {
      env: [
        'DISCORD_ENABLED=true',
        'DISCORD_MAIN_BOT_TOKEN=main.real.token',
        'DISCORD_MAIN_BOT_CLIENT_ID=123456789012345678',
        'DISCORD_GUILD_ID=223456789012345678',
        'AGENTS_DIR=./agents',
        'ANTHROPIC_API_KEY=',
        '',
      ].join('\n'),
      settings: {
        model: 'sonnet',
        env: {
          ANTHROPIC_BASE_URL: 'https://proxy.example.com',
        },
      },
    });

    const result = runSetupCheck({ cwd: root });

    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.checks.some((check) => check.area === 'auth' && check.message.includes('agent env has no ANTHROPIC_API_KEY'))).toBe(true);
  });
});
