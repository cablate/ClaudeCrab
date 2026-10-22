import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type Level = 'ok' | 'warn' | 'error';

export interface Check {
  level: Level;
  area: string;
  message: string;
}

export interface SetupCheckResult {
  checks: Check[];
  errorCount: number;
  warningCount: number;
}

export interface SetupCheckOptions {
  args?: string[];
  cwd?: string;
  nodeVersion?: string;
}

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /^your-/i,
  /^replace-with-/i,
  /^.*-token$/i,
  /^.*-channel-id$/i,
  /^.*-server-id$/i,
  /^.*-application-id$/i,
  /^.*-client-id$/i,
];

const DISCORD_TOKEN_HINT = /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}/;
const AGENT_JSON_RUNTIME_FIELDS = [
  'model',
  'allowedTools',
  'disallowedTools',
  'systemPrompt',
  'systemPromptFile',
  'maxTokens',
  'maxThinkingTokens',
  'settings',
];

export function runSetupCheck(options: SetupCheckOptions = {}): SetupCheckResult {
  const args = options.args ?? [];
  const cwd = options.cwd ?? process.cwd();
  const agentId = readArg(args, '--agent') ?? 'example';
  const templateMode = args.includes('--template');
  const checks: Check[] = [];

  checkNodeVersion(options.nodeVersion ?? process.versions.node, checks);

  const envPath = path.resolve(cwd, templateMode ? '.env.example' : '.env');
  const envExamplePath = path.resolve(cwd, '.env.example');
  const env = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf-8')) : {};

  checkEnvFiles(cwd, envPath, envExamplePath, checks, templateMode);
  checkRequiredEnv(env, checks, templateMode);

  const agentsDirOverride = readArg(args, '--agents-dir');
  const agentsDir = agentsDirOverride ?? (env.AGENTS_DIR && !isPlaceholder(env.AGENTS_DIR) ? env.AGENTS_DIR : './agents');
  const agentsDirPath = path.resolve(cwd, agentsDir);
  const agentPath = path.join(agentsDirPath, agentId);
  const agentJsonPath = path.join(agentPath, 'agent.json');
  const claudeSettingsPath = path.join(agentPath, '.claude', 'settings.local.json');
  const claudeMdPath = path.join(agentPath, 'CLAUDE.md');

  if (!existsSync(agentsDirPath) || !statSync(agentsDirPath).isDirectory()) {
    checks.push({ level: 'error', area: 'agents', message: `AGENTS_DIR 不存在或不是目錄：${agentsDir}` });
  } else {
    checks.push({ level: 'ok', area: 'agents', message: `AGENTS_DIR 存在：${agentsDir}` });
  }

  const agentConfig = readJsonRecord(cwd, agentJsonPath, checks, 'agent.json');
  if (agentConfig) {
    checkAgentConfig(agentConfig, env, checks, templateMode);
  }

  const settings = readJsonRecord(cwd, claudeSettingsPath, checks, '.claude/settings.local.json');
  if (settings) {
    checkClaudeSettings(settings, checks);
  }

  if (!existsSync(claudeMdPath)) {
    checks.push({
      level: 'warn',
      area: 'CLAUDE.md',
      message: `${relative(cwd, claudeMdPath)} 不存在；agent 將在沒有專案指令檔的情況下執行。`,
    });
  }

  checkAuthMode(env, settings, checks, templateMode);
  const errorCount = checks.filter((check) => check.level === 'error').length;
  const warningCount = checks.filter((check) => check.level === 'warn').length;
  return { checks, errorCount, warningCount };
}

function main(): void {
  const result = runSetupCheck({ args: process.argv.slice(2) });
  printChecks(result.checks);
  if (result.errorCount > 0) {
    process.exitCode = 1;
  }
}

function checkEnvFiles(
  cwd: string,
  envPath: string,
  envExamplePath: string,
  checks: Check[],
  templateMode: boolean,
): void {
  if (!existsSync(envPath)) {
    checks.push({
      level: templateMode ? 'warn' : 'error',
      area: '.env',
      message: templateMode
        ? '.env.example 不存在，無法檢查範本設定。'
        : '.env 不存在。請執行 "cp .env.example .env"，再填入必要值。',
    });
  } else {
    checks.push({ level: 'ok', area: '.env', message: `${relative(cwd, envPath)} 存在` });
  }

  if (!existsSync(envExamplePath)) {
    checks.push({ level: 'warn', area: '.env.example', message: '.env.example 不存在；新使用者將沒有設定範本。' });
  }
}

function checkRequiredEnv(env: Record<string, string>, checks: Check[], templateMode: boolean): void {
  requireEnv(env, 'DISCORD_ENABLED', checks, undefined, templateMode);
  if (env.DISCORD_ENABLED !== 'true') {
    checks.push({ level: 'error', area: '.env', message: 'DISCORD_ENABLED 必須為 true，Discord runtime 才能啟動。' });
  }
  requireEnv(env, 'DISCORD_MAIN_BOT_TOKEN', checks, undefined, templateMode);
  requireEnv(env, 'DISCORD_MAIN_BOT_CLIENT_ID', checks, isDiscordId, templateMode);
  requireEnv(env, 'DISCORD_GUILD_ID', checks, isDiscordId, templateMode);
  requireEnv(env, 'AGENTS_DIR', checks, undefined, templateMode);
  checkDiscordEnvShape(env, checks, templateMode);
  checkOptionalDiscordOwnerUserId(env, checks, templateMode);
  checkAllowedUsers(env, checks, templateMode);
}

function checkNodeVersion(nodeVersion: string, checks: Check[]): void {
  const majorText = nodeVersion.split('.')[0] ?? '';
  const major = Number.parseInt(majorText, 10);
  if (!Number.isFinite(major)) {
    checks.push({ level: 'warn', area: 'node', message: `無法解析 Node.js 版本：${nodeVersion}` });
    return;
  }
  if (major < 22) {
    checks.push({ level: 'error', area: 'node', message: `需要 Node.js 22 以上。目前版本：${nodeVersion}` });
    return;
  }
  checks.push({ level: 'ok', area: 'node', message: `Node.js 版本受支援：${nodeVersion}` });
}

function checkAgentConfig(
  agentConfig: Record<string, unknown>,
  env: Record<string, string>,
  checks: Check[],
  templateMode: boolean,
): void {
  requireJsonString(agentConfig, 'name', checks, 'agent.json');
  requireJsonString(agentConfig, 'discordBotToken', checks, 'agent.json', undefined, templateMode);
  requireJsonString(agentConfig, 'discordChannelId', checks, 'agent.json', isDiscordId, templateMode);
  checkDiscordBotSeparation(env, agentConfig, checks, templateMode);

  for (const field of AGENT_JSON_RUNTIME_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(agentConfig, field)) continue;
    checks.push({
      level: 'error',
      area: 'agent.json',
      message: `${field} 應放在 .claude/settings.local.json 或專用 runtime 設定。請移除 agent.json 的 ${field}，避免 runtime 設定衝突。`,
    });
  }
}

function checkClaudeSettings(settings: Record<string, unknown>, checks: Check[]): void {
  const envValue = settings.env;
  if (envValue !== undefined && (typeof envValue !== 'object' || envValue === null || Array.isArray(envValue))) {
    checks.push({ level: 'error', area: '.claude/settings.local.json', message: 'env 必須是物件。' });
  }
  if (settings.model !== undefined && (typeof settings.model !== 'string' || settings.model.trim() === '')) {
    checks.push({ level: 'error', area: '.claude/settings.local.json', message: 'model 若設定，必須是非空字串。' });
  }
}

function checkDiscordEnvShape(env: Record<string, string>, checks: Check[], templateMode: boolean): void {
  const mainBotToken = env.DISCORD_MAIN_BOT_TOKEN ?? '';
  const mainClientId = env.DISCORD_MAIN_BOT_CLIENT_ID ?? '';
  const guildId = env.DISCORD_GUILD_ID ?? '';

  if (!templateMode && !isPlaceholder(mainBotToken) && isDiscordId(mainBotToken)) {
    checks.push({
      level: 'error',
      area: 'discord',
      message: 'DISCORD_MAIN_BOT_TOKEN 看起來像 Discord ID。請改貼 Developer Portal > Bot > Token 的 bot token。',
    });
  }

  for (const [key, value] of [
    ['DISCORD_MAIN_BOT_CLIENT_ID', mainClientId],
    ['DISCORD_GUILD_ID', guildId],
  ] as const) {
    if (!templateMode && !isPlaceholder(value) && DISCORD_TOKEN_HINT.test(value)) {
      checks.push({
        level: 'error',
        area: 'discord',
        message: `${key} 看起來像 bot token。請開啟 Discord Developer Mode，改複製數字 ID。`,
      });
    }
  }

  if (!isPlaceholder(mainClientId) && !isPlaceholder(guildId) && mainClientId === guildId) {
    checks.push({
      level: 'error',
      area: 'discord',
      message: 'DISCORD_MAIN_BOT_CLIENT_ID 與 DISCORD_GUILD_ID 相同。Client ID 是 application ID；guild ID 是 server ID。',
    });
  }
}

function checkOptionalDiscordOwnerUserId(env: Record<string, string>, checks: Check[], templateMode: boolean): void {
  const ownerUserId = env.DISCORD_OWNER_USER_ID ?? '';
  if (isPlaceholder(ownerUserId)) {
    if (templateMode) {
      checks.push({ level: 'ok', area: '.env', message: 'DISCORD_OWNER_USER_ID 為選填。' });
    }
    return;
  }
  if (DISCORD_TOKEN_HINT.test(ownerUserId)) {
    checks.push({
      level: 'error',
      area: '.env',
      message: 'DISCORD_OWNER_USER_ID 看起來像 bot token。請開啟 Discord Developer Mode，改複製你的數字 user ID。',
    });
    return;
  }
  if (!isDiscordId(ownerUserId)) {
    checks.push({
      level: 'error',
      area: '.env',
      message: 'DISCORD_OWNER_USER_ID 若設定，必須是數字 Discord user ID。',
    });
    return;
  }
  checks.push({ level: 'ok', area: '.env', message: 'DISCORD_OWNER_USER_ID 已設定' });
}

function checkAllowedUsers(env: Record<string, string>, checks: Check[], templateMode: boolean): void {
  const value = env.ALLOWED_USERS?.trim() ?? '';
  if (value === '') {
    checks.push({
      level: templateMode ? 'ok' : 'warn',
      area: 'security',
      message: templateMode
        ? 'ALLOWED_USERS 為選填；公開或多人 Discord server 強烈建議設定。'
        : 'ALLOWED_USERS 未設定，目前 agent channel 內所有使用者都可呼叫 Claude。公開或多人 server 請填入允許的 Discord user ID。',
    });
    return;
  }

  const userIds = value.split(',').map((item) => item.trim()).filter(Boolean);
  const invalid = userIds.filter((userId) => !isDiscordId(userId));
  if (invalid.length > 0) {
    checks.push({
      level: 'error',
      area: 'security',
      message: `ALLOWED_USERS 必須是以逗號分隔的 Discord user ID；目前有 ${invalid.length} 筆格式錯誤。`,
    });
    return;
  }

  checks.push({
    level: 'ok',
    area: 'security',
    message: `ALLOWED_USERS 已限制為 ${userIds.length} 位使用者。`,
  });
}

function checkDiscordBotSeparation(
  env: Record<string, string>,
  agentConfig: Record<string, unknown>,
  checks: Check[],
  templateMode: boolean,
): void {
  const mainBotToken = env.DISCORD_MAIN_BOT_TOKEN ?? '';
  const mainClientId = env.DISCORD_MAIN_BOT_CLIENT_ID ?? '';
  const guildId = env.DISCORD_GUILD_ID ?? '';
  const agentBotToken = typeof agentConfig.discordBotToken === 'string' ? agentConfig.discordBotToken : '';
  const channelId = typeof agentConfig.discordChannelId === 'string' ? agentConfig.discordChannelId : '';

  if (!templateMode && !isPlaceholder(agentBotToken) && isDiscordId(agentBotToken)) {
    checks.push({
      level: 'error',
      area: 'discord',
      message: 'agent discordBotToken 看起來像 Discord ID。請改貼 Developer Portal > Bot > Token 的 agent bot token。',
    });
  }
  if (!templateMode && !isPlaceholder(channelId) && DISCORD_TOKEN_HINT.test(channelId)) {
    checks.push({
      level: 'error',
      area: 'discord',
      message: 'agent discordChannelId 看起來像 bot token。請開啟 Discord Developer Mode，改複製數字 channel ID。',
    });
  }

  if (isPlaceholder(mainBotToken) || isPlaceholder(agentBotToken)) {
    if (templateMode) {
      checks.push({ level: 'ok', area: 'discord', message: '範本將主 bot 與 agent bot token 保留為占位值。' });
    }
  } else if (mainBotToken === agentBotToken) {
    checks.push({
      level: 'error',
      area: 'discord',
      message: 'DISCORD_MAIN_BOT_TOKEN 與 agent discordBotToken 相同。正式環境請使用不同 bot，或確認這是刻意設定再繼續。',
    });
  } else {
    checks.push({ level: 'ok', area: 'discord', message: '主 bot token 與 agent bot token 不同。' });
  }

  if (!isPlaceholder(guildId) && !isPlaceholder(channelId) && guildId === channelId) {
    checks.push({
      level: 'error',
      area: 'discord',
      message: 'DISCORD_GUILD_ID 與 agent discordChannelId 相同。Server ID 與 channel ID 是不同的值。',
    });
  }
  if (!isPlaceholder(mainClientId) && !isPlaceholder(channelId) && mainClientId === channelId) {
    checks.push({
      level: 'error',
      area: 'discord',
      message: 'DISCORD_MAIN_BOT_CLIENT_ID 與 agent discordChannelId 相同。Application ID 與 channel ID 是不同的值。',
    });
  }
}

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) continue;
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readJsonRecord(cwd: string, filePath: string, checks: Check[], area: string): Record<string, unknown> | undefined {
  if (!existsSync(filePath)) {
    checks.push({ level: 'error', area, message: `${relative(cwd, filePath)} 不存在。` });
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      checks.push({ level: 'error', area, message: `${relative(cwd, filePath)} 必須是 JSON 物件。` });
      return undefined;
    }
    checks.push({ level: 'ok', area, message: `${relative(cwd, filePath)} 是有效 JSON` });
    return parsed as Record<string, unknown>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    checks.push({ level: 'error', area, message: `${relative(cwd, filePath)} JSON 無效：${reason}` });
    return undefined;
  }
}

function requireEnv(
  env: Record<string, string>,
  key: string,
  checks: Check[],
  validator?: (value: string) => boolean,
  allowPlaceholder = false,
): void {
  const value = env[key] ?? '';
  if (isPlaceholder(value)) {
    checks.push({
      level: allowPlaceholder ? 'warn' : 'error',
      area: '.env',
      message: allowPlaceholder
        ? `${key} 為空或占位值；範本模式允許。`
        : `${key} 為必填，不能為空或占位值。`,
    });
    return;
  }
  if (validator && !validator(value)) {
    checks.push({
      level: 'error',
      area: '.env',
      message: `${key} 必須是數字 Discord ID。請開啟 Developer Mode 並複製正確的 ID。`,
    });
    return;
  }
  checks.push({ level: 'ok', area: '.env', message: `${key} 已設定` });
}

function requireJsonString(
  data: Record<string, unknown>,
  key: string,
  checks: Check[],
  area: string,
  validator?: (value: string) => boolean,
  allowPlaceholder = false,
): void {
  const value = data[key];
  if (typeof value !== 'string' || isPlaceholder(value)) {
    checks.push({
      level: allowPlaceholder ? 'warn' : 'error',
      area,
      message: allowPlaceholder
        ? `${key} 為空或占位值；範本模式允許。`
        : `${key} 為必填，不能為空或占位值。`,
    });
    return;
  }
  if (validator && !validator(value)) {
    checks.push({
      level: 'error',
      area,
      message: `${key} 必須是數字 Discord ID。請開啟 Developer Mode 並複製正確的 ID。`,
    });
    return;
  }
  checks.push({ level: 'ok', area, message: `${key} 已設定` });
}

function checkAuthMode(
  env: Record<string, string>,
  settings: Record<string, unknown> | undefined,
  checks: Check[],
  templateMode: boolean,
): void {
  const globalApiKey = env.ANTHROPIC_API_KEY ?? '';
  const globalBaseUrl = env.ANTHROPIC_BASE_URL ?? '';
  const agentEnv = settings?.env && typeof settings.env === 'object' && !Array.isArray(settings.env)
    ? settings.env as Record<string, unknown>
    : {};
  const agentApiKey = typeof agentEnv.ANTHROPIC_API_KEY === 'string' ? agentEnv.ANTHROPIC_API_KEY : '';
  const agentAuthToken = typeof agentEnv.ANTHROPIC_AUTH_TOKEN === 'string' ? agentEnv.ANTHROPIC_AUTH_TOKEN : '';
  const agentBaseUrl = typeof agentEnv.ANTHROPIC_BASE_URL === 'string' ? agentEnv.ANTHROPIC_BASE_URL : '';

  if (!isPlaceholder(agentApiKey) || !isPlaceholder(agentAuthToken)) {
    const credentialName = !isPlaceholder(agentApiKey) ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN';
    checks.push({
      level: 'ok',
      area: 'auth',
      message: `Agent 層級的 ${credentialName} 已設定；Claude Code 會從此 agent 設定檔讀取。`,
    });
    if (isPlaceholder(agentBaseUrl)) {
      checks.push({
        level: 'warn',
        area: 'auth',
        message: 'Agent 層級憑證已設定但沒有 ANTHROPIC_BASE_URL。Anthropic API key 模式沒問題，但 proxy/provider 通常需要 base URL。',
      });
    }
    if (!isPlaceholder(agentApiKey) && !isPlaceholder(agentAuthToken)) {
      checks.push({
        level: 'warn',
        area: 'auth',
        message: '同時設定了 agent ANTHROPIC_API_KEY 與 ANTHROPIC_AUTH_TOKEN。請只保留你的 provider 預期的憑證類型。',
      });
    }
    return;
  }

  if (!isPlaceholder(agentBaseUrl)) {
    checks.push({
      level: 'error',
      area: 'auth',
      message: 'Agent 層級 ANTHROPIC_BASE_URL 已設定，但 agent env 沒有 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN。',
    });
    return;
  }

  if (!isPlaceholder(globalApiKey)) {
    checks.push({ level: 'ok', area: 'auth', message: '全域 ANTHROPIC_API_KEY 已設定。' });
    if (!isPlaceholder(globalBaseUrl)) {
      checks.push({
        level: 'warn',
        area: 'auth',
        message: '全域 ANTHROPIC_BASE_URL 已設定。各 agent 使用不同 proxy/provider 時，建議改放 agent .claude/settings.local.json 的 env。',
      });
    }
    return;
  }

  if (!isPlaceholder(globalBaseUrl)) {
    checks.push({
      level: 'error',
      area: 'auth',
      message: 'ANTHROPIC_BASE_URL 已設定但找不到 ANTHROPIC_API_KEY。OAuth 模式不應設定 ANTHROPIC_BASE_URL。',
    });
    return;
  }

  checks.push({
    level: templateMode ? 'ok' : 'warn',
    area: 'auth',
    message: templateMode
      ? '範本未包含憑證。'
      : '找不到 API key。只有當主機已執行過 claude login 且 OAuth 憑證可讀時，這才算正常。',
  });
}

function isDiscordId(value: string): boolean {
  return /^\d{15,25}$/.test(value);
}

function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function printChecks(checks: Check[]): void {
  for (const check of checks) {
    const prefix = check.level === 'ok' ? 'ok' : check.level;
    console.log(`${prefix.padEnd(5)} ${check.area.padEnd(30)} ${check.message}`);
  }

  const errors = checks.filter((check) => check.level === 'error').length;
  const warnings = checks.filter((check) => check.level === 'warn').length;
  console.log('');
  console.log(`setup-check：${errors} 個錯誤，${warnings} 個警告`);
}

function relative(cwd: string, filePath: string): string {
  return path.relative(cwd, filePath).replaceAll('\\', '/');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
