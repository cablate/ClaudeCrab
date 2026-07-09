import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  formatRuntimeConfigIssues,
  loadAppConfig,
  validateAppConfigForRuntime,
} from '../src/config.ts';
import { loadSecurityConfig } from '../src/utils/security.ts';

describe('AppConfig', () => {
  let tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots = [];
  });

  it('loads defaults from an injected env and cwd', () => {
    const config = loadAppConfig({}, 'C:/project');

    expect(config.agentsDir).toBe('C:\\project\\agents');
    expect(config.persistence.enabled).toBe(false);
    expect(config.discord.enabled).toBe(false);
    expect(config.admin.enabled).toBe(false);
    expect(config.admin.host).toBe('127.0.0.1');
    expect(config.admin.port).toBe(47_824);
    expect(config.discord.inChatUsageSummary).toBe(true);
    expect(config.session.idleCloseMs).toBe(7_200_000);
    expect(config.schedule.catchUpCheckIntervalMs).toBe(1_800_000);
  });

  it('applies env overrides through the central parser', () => {
    const config = loadAppConfig({
      AGENTS_DIR: 'D:/agents',
      ENABLE_PERSISTENCE: 'true',
      DB_PATH: './custom.db',
      DISCORD_ENABLED: 'true',
      DISCORD_MAIN_BOT_TOKEN: 'token',
      DISCORD_MAIN_BOT_CLIENT_ID: 'client-id',
      DISCORD_GUILD_ID: 'guild-id',
      DISCORD_OWNER_USER_ID: '123456',
      IN_CHAT_USAGE_SUMMARY_ENABLED: 'false',
      SESSION_IDLE_CLOSE_MS: '1234',
      CACHE_KEEPALIVE_DETECTED_TTL_RATIO: '0.5',
      ADMIN_CONSOLE_ENABLED: 'true',
      ADMIN_CONSOLE_TOKEN: 'fixture-admin-console-token',
      ADMIN_CONSOLE_PORT: '49999',
    }, 'C:/project');

    expect(config.agentsDir).toBe('D:/agents');
    expect(config.persistence).toEqual({ enabled: true, dbPath: './custom.db' });
    expect(config.discord.enabled).toBe(true);
    expect(config.discord.ownerUserId).toBe('123456');
    expect(config.discord.inChatUsageSummary).toBe(false);
    expect(config.session.idleCloseMs).toBe(1234);
    expect(config.cacheKeepalive.detectedTTLRatio).toBe(0.5);
    expect(config.admin.enabled).toBe(true);
    expect(config.admin.token).toBe('fixture-admin-console-token');
    expect(config.admin.port).toBe(49_999);
  });

  it('loads local config overlay after environment values', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'claudecab-config-'));
    tempRoots.push(root);
    await mkdir(path.join(root, 'data'), { recursive: true });
    await writeFile(path.join(root, 'data', 'claudecab.local.json'), JSON.stringify({
      DISCORD_OWNER_USER_ID: 'local-owner',
      ADMIN_CONSOLE_ENABLED: true,
      ADMIN_CONSOLE_TOKEN: 'local-token-12345',
    }), 'utf-8');

    const config = loadAppConfig({ DISCORD_OWNER_USER_ID: 'env-owner' }, root);

    expect(config.discord.ownerUserId).toBe('local-owner');
    expect(config.admin.enabled).toBe(true);
    expect(config.admin.token).toBe('local-token-12345');
  });

  it('reports missing Discord runtime fields with actionable env names', () => {
    const config = loadAppConfig({ DISCORD_ENABLED: 'true' }, 'C:/project');
    const result = validateAppConfigForRuntime(config);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.envVars).flat()).toEqual([
      'DISCORD_MAIN_BOT_TOKEN',
      'DISCORD_MAIN_BOT_CLIENT_ID',
    ]);
    expect(formatRuntimeConfigIssues(result.issues)).toContain('DISCORD_MAIN_BOT_TOKEN');
  });
});

describe('security config', () => {
  it('does not read process.env when AppConfig values are absent', () => {
    vi.stubEnv('ALLOWED_USERS', 'should-not-apply');
    vi.stubEnv('MAX_MESSAGE_LENGTH', '5');
    vi.stubEnv('PROMPT_INJECTION_DETECTION', 'false');
    try {
      const config = loadSecurityConfig();

      expect(config.allowedUsers).toEqual([]);
      expect(config.maxMessageLength).toBe(10_000);
      expect(config.promptInjectionDetection).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
