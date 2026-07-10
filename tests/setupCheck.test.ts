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

  it('warns when Discord access is not restricted', async () => {
    const root = await createTempRoot();
    await writeBaseProject(root);

    const result = runSetupCheck({ cwd: root });

    expect(result.checks.some((check) =>
      check.area === 'security'
      && check.level === 'warn'
      && check.message.includes('所有使用者都可呼叫 Claude'),
    )).toBe(true);
  });

  it('accepts a Discord user allowlist', async () => {
    const root = await createTempRoot();
    await writeBaseProject(root, {
      env: [
        'DISCORD_ENABLED=true',
        'DISCORD_MAIN_BOT_TOKEN=main.real.token',
        `DISCORD_MAIN_BOT_CLIENT_ID=${'1'.repeat(18)}`,
        `DISCORD_GUILD_ID=${'2'.repeat(18)}`,
        'AGENTS_DIR=./agents',
        'ANTHROPIC_API_KEY=sk-test',
        `ALLOWED_USERS=${'3'.repeat(18)},${'4'.repeat(18)}`,
        '',
      ].join('\n'),
    });

    const result = runSetupCheck({ cwd: root });

    expect(result.errorCount).toBe(0);
    expect(result.checks.some((check) =>
      check.area === 'security'
      && check.level === 'ok'
      && check.message.includes('2 位使用者'),
    )).toBe(true);
  });

  it('rejects unsupported Node.js versions', async () => {
    const root = await createTempRoot();
    await writeBaseProject(root);

    const result = runSetupCheck({ cwd: root, nodeVersion: '18.20.0' });

    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.checks.some((check) => check.area === 'node' && check.message.includes('需要 Node.js 20 以上'))).toBe(true);
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

  it('rejects legacy agent.json model settings', async () => {
    const root = await createTempRoot();
    await writeBaseProject(root, {
      agent: {
        model: 'sonnet',
      },
    });

    const result = runSetupCheck({ cwd: root });

    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.checks.some((check) => check.area === 'agent.json' && check.message.includes('model 應放在 .claude/settings.local.json'))).toBe(true);
  });

  it('rejects shared main bot and agent bot tokens', async () => {
    const root = await createTempRoot();
    await writeBaseProject(root, {
      agent: { discordBotToken: 'main.real.token' },
    });

    const result = runSetupCheck({ cwd: root });

    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.checks.some((check) => check.area === 'discord' && check.message.includes('與 agent discordBotToken 相同'))).toBe(true);
  });

  it('rejects missing AGENTS_DIR instead of silently falling back', async () => {
    const root = await createTempRoot();
    await writeBaseProject(root, {
      env: [
        'DISCORD_ENABLED=true',
        'DISCORD_MAIN_BOT_TOKEN=main.real.token',
        'DISCORD_MAIN_BOT_CLIENT_ID=123456789012345678',
        'DISCORD_GUILD_ID=223456789012345678',
        'ANTHROPIC_API_KEY=sk-test',
        '',
      ].join('\n'),
    });

    const result = runSetupCheck({ cwd: root });

    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.checks.some((check) => check.area === '.env' && check.message.includes('AGENTS_DIR 為必填'))).toBe(true);
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
    expect(result.checks.some((check) => check.message.includes('DISCORD_MAIN_BOT_TOKEN 看起來像 Discord ID'))).toBe(true);
    expect(result.checks.some((check) => check.message.includes('agent discordBotToken 看起來像 Discord ID'))).toBe(true);
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
    expect(result.checks.some((check) => check.message.includes('Client ID 是 application ID'))).toBe(true);
    expect(result.checks.some((check) => check.message.includes('Server ID 與 channel ID 是不同的值'))).toBe(true);
    expect(result.checks.some((check) => check.message.includes('Application ID 與 channel ID 是不同的值'))).toBe(true);
  });

  it('rejects malformed Discord owner user IDs', async () => {
    const root = await createTempRoot();
    await writeBaseProject(root, {
      env: [
        'DISCORD_ENABLED=true',
        'DISCORD_MAIN_BOT_TOKEN=main.real.token',
        'DISCORD_MAIN_BOT_CLIENT_ID=123456789012345678',
        'DISCORD_GUILD_ID=223456789012345678',
        'DISCORD_OWNER_USER_ID=not-a-discord-id',
        'AGENTS_DIR=./agents',
        'ANTHROPIC_API_KEY=sk-test',
        '',
      ].join('\n'),
    });

    const result = runSetupCheck({ cwd: root });

    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.checks.some((check) => check.message.includes('必須是數字 Discord user ID'))).toBe(true);
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
    expect(result.checks.some((check) => check.area === 'auth' && check.message.includes('OAuth 模式'))).toBe(true);
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
        model: 'deepseek-v4-flash[1m]',
        env: {
          ANTHROPIC_API_KEY: 'provider-key',
          ANTHROPIC_BASE_URL: 'https://proxy.example.com',
        },
      },
    });

    const result = runSetupCheck({ cwd: root });

    expect(result.errorCount).toBe(0);
    expect(result.checks.some((check) => check.area === 'auth' && check.message.includes('Claude Code 會從此 agent 設定檔讀取'))).toBe(true);
  });

  it('accepts agent-level auth token provider credentials', async () => {
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
        model: 'glm-5.2[1m]',
        env: {
          ANTHROPIC_AUTH_TOKEN: 'provider-auth-secret',
          ANTHROPIC_BASE_URL: 'https://proxy.example.com',
        },
      },
    });

    const result = runSetupCheck({ cwd: root });

    expect(result.errorCount).toBe(0);
    expect(result.checks.some((check) => check.area === 'auth' && check.message.includes('ANTHROPIC_AUTH_TOKEN'))).toBe(true);
  });

  it('rejects agent-level proxy base URL without a credential', async () => {
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
    expect(result.checks.some((check) => check.area === 'auth' && check.message.includes('ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN'))).toBe(true);
  });
});
