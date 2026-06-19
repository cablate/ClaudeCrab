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
}

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /^your-/i,
  /^replace-with-/i,
  /^你的/,
  /^.*-token$/i,
  /^.*-channel-id$/i,
  /^.*-server-id$/i,
  /^.*-application-id$/i,
  /^.*-client-id$/i,
];

export function runSetupCheck(options: SetupCheckOptions = {}): SetupCheckResult {
  const args = options.args ?? [];
  const cwd = options.cwd ?? process.cwd();
  const agentId = readArg(args, '--agent') ?? 'example';
  const templateMode = args.includes('--template');
  const checks: Check[] = [];

  const envPath = path.resolve(cwd, templateMode ? '.env.example' : '.env');
  const envExamplePath = path.resolve(cwd, '.env.example');
  const env = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf-8')) : {};

  if (!existsSync(envPath)) {
    checks.push({
      level: templateMode ? 'warn' : 'error',
      area: '.env',
      message: templateMode
        ? '.env.example 不存在，無法驗證設定範本。'
        : '.env 不存在。請先執行 cp .env.example .env，並填入必要設定。',
    });
  } else {
    checks.push({ level: 'ok', area: '.env', message: `${relative(cwd, envPath)} exists` });
  }

  if (!existsSync(envExamplePath)) {
    checks.push({ level: 'warn', area: '.env.example', message: '.env.example 不存在，使用者會缺少設定範本。' });
  }

  requireEnv(env, 'DISCORD_ENABLED', checks, undefined, templateMode);
  if (env.DISCORD_ENABLED !== 'true') {
    checks.push({ level: 'error', area: '.env', message: 'DISCORD_ENABLED 必須是 true，Discord runtime 才會啟動。' });
  }
  requireEnv(env, 'DISCORD_MAIN_BOT_TOKEN', checks, undefined, templateMode);
  requireEnv(env, 'DISCORD_MAIN_BOT_CLIENT_ID', checks, isDiscordId, templateMode);
  requireEnv(env, 'DISCORD_GUILD_ID', checks, isDiscordId, templateMode);

  const agentsDirOverride = readArg(args, '--agents-dir');
  const agentsDir = agentsDirOverride ?? (env.AGENTS_DIR && !isPlaceholder(env.AGENTS_DIR)
    ? env.AGENTS_DIR
    : './agents');
  const agentsDirPath = path.resolve(cwd, agentsDir);
  const agentPath = path.join(agentsDirPath, agentId);
  const agentJsonPath = path.join(agentPath, 'agent.json');
  const claudeSettingsPath = path.join(agentPath, '.claude', 'settings.local.json');
  const claudeMdPath = path.join(agentPath, 'CLAUDE.md');

  if (!existsSync(agentsDirPath) || !statSync(agentsDirPath).isDirectory()) {
    checks.push({ level: 'error', area: 'agents', message: `AGENTS_DIR 不存在或不是資料夾：${agentsDir}` });
  } else {
    checks.push({ level: 'ok', area: 'agents', message: `AGENTS_DIR exists: ${agentsDir}` });
  }

  const agentConfig = readJsonRecord(cwd, agentJsonPath, checks, 'agent.json');
  if (agentConfig) {
    requireJsonString(agentConfig, 'name', checks, 'agent.json');
    requireJsonString(agentConfig, 'discordBotToken', checks, 'agent.json', undefined, templateMode);
    requireJsonString(agentConfig, 'discordChannelId', checks, 'agent.json', isDiscordId, templateMode);
    checkDiscordBotSeparation(env, agentConfig, checks, templateMode);
    if (typeof agentConfig.model === 'string') {
      if (!['sonnet', 'opus', 'haiku'].includes(agentConfig.model)) {
        checks.push({ level: 'error', area: 'agent.json', message: 'model 必須是 sonnet、opus 或 haiku。' });
      }
    } else {
      checks.push({ level: 'warn', area: 'agent.json', message: 'model 未設定，runtime 會使用預設 sonnet。' });
    }
  }

  const settings = readJsonRecord(cwd, claudeSettingsPath, checks, '.claude/settings.local.json');
  if (settings) {
    const envValue = settings.env;
    if (envValue !== undefined && (typeof envValue !== 'object' || envValue === null || Array.isArray(envValue))) {
      checks.push({ level: 'error', area: '.claude/settings.local.json', message: 'env 必須是 object。' });
    }
    if (typeof settings.model === 'string' && !['sonnet', 'opus', 'haiku'].includes(settings.model)) {
      checks.push({ level: 'error', area: '.claude/settings.local.json', message: 'model 必須是 sonnet、opus 或 haiku。' });
    }
  }

  if (!existsSync(claudeMdPath)) {
    checks.push({ level: 'warn', area: 'CLAUDE.md', message: `${relative(cwd, claudeMdPath)} 不存在，agent 會缺少專案提示詞。` });
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

function checkDiscordBotSeparation(
  env: Record<string, string>,
  agentConfig: Record<string, unknown>,
  checks: Check[],
  templateMode: boolean,
): void {
  const mainBotToken = env.DISCORD_MAIN_BOT_TOKEN ?? '';
  const agentBotToken = typeof agentConfig.discordBotToken === 'string' ? agentConfig.discordBotToken : '';
  if (isPlaceholder(mainBotToken) || isPlaceholder(agentBotToken)) {
    if (templateMode) {
      checks.push({ level: 'ok', area: 'discord', message: 'Template keeps main bot and agent bot tokens as placeholders.' });
    }
    return;
  }
  if (mainBotToken === agentBotToken) {
    checks.push({
      level: 'error',
      area: 'discord',
      message: 'DISCORD_MAIN_BOT_TOKEN 和 agent discordBotToken 相同。建議使用不同 Bot，避免主 Bot / Agent Bot 職責混淆。',
    });
    return;
  }
  checks.push({ level: 'ok', area: 'discord', message: 'Main bot token and agent bot token are distinct.' });

  const guildId = env.DISCORD_GUILD_ID ?? '';
  const channelId = typeof agentConfig.discordChannelId === 'string' ? agentConfig.discordChannelId : '';
  if (!isPlaceholder(guildId) && !isPlaceholder(channelId) && guildId === channelId) {
    checks.push({
      level: 'error',
      area: 'discord',
      message: 'DISCORD_GUILD_ID 和 agent discordChannelId 相同。Server ID 和 Channel ID 是不同值。',
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
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
      checks.push({ level: 'error', area, message: `${relative(cwd, filePath)} 必須是 JSON object。` });
      return undefined;
    }
    checks.push({ level: 'ok', area, message: `${relative(cwd, filePath)} is valid JSON` });
    return parsed as Record<string, unknown>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    checks.push({ level: 'error', area, message: `${relative(cwd, filePath)} JSON 格式錯誤：${reason}` });
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
      message: allowPlaceholder ? `${key} 是空白/placeholder；template 模式允許。` : `${key} 未填或仍是 placeholder。`,
    });
    return;
  }
  if (validator && !validator(value)) {
    checks.push({ level: 'error', area: '.env', message: `${key} 格式看起來不正確。` });
    return;
  }
  checks.push({ level: 'ok', area: '.env', message: `${key} is set` });
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
      message: allowPlaceholder ? `${key} 是空白/placeholder；template 模式允許。` : `${key} 未填或仍是 placeholder。`,
    });
    return;
  }
  if (validator && !validator(value)) {
    checks.push({ level: 'error', area, message: `${key} 格式看起來不正確。` });
    return;
  }
  checks.push({ level: 'ok', area, message: `${key} is set` });
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
  const agentBaseUrl = typeof agentEnv.ANTHROPIC_BASE_URL === 'string' ? agentEnv.ANTHROPIC_BASE_URL : '';

  if (!isPlaceholder(agentApiKey)) {
    checks.push({
      level: 'ok',
      area: 'auth',
      message: 'Agent-level ANTHROPIC_API_KEY is set; ClaudeCab will redirect CLAUDE_CONFIG_DIR for this agent.',
    });
    if (isPlaceholder(agentBaseUrl)) {
      checks.push({
        level: 'warn',
        area: 'auth',
        message: 'Agent-level API key is set without ANTHROPIC_BASE_URL. This is fine for Anthropic, but proxy/provider setups usually need a base URL.',
      });
    }
    return;
  }

  if (!isPlaceholder(globalApiKey)) {
    checks.push({ level: 'ok', area: 'auth', message: 'Global ANTHROPIC_API_KEY is set.' });
    if (!isPlaceholder(globalBaseUrl)) {
      checks.push({
        level: 'warn',
        area: 'auth',
        message: 'Global ANTHROPIC_BASE_URL is set. For per-agent proxy/provider setups, prefer agent .claude/settings.local.json env.',
      });
    }
    return;
  }

  if (!isPlaceholder(globalBaseUrl)) {
    checks.push({
      level: 'error',
      area: 'auth',
      message: 'ANTHROPIC_BASE_URL is set but no ANTHROPIC_API_KEY was found. OAuth mode should not set ANTHROPIC_BASE_URL.',
    });
    return;
  }

  checks.push({
    level: templateMode ? 'ok' : 'warn',
    area: 'auth',
    message: templateMode
      ? 'Template does not include credentials.'
      : 'No API key found. This is OK only if the host has already run claude login and OAuth credentials are readable.',
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
  console.log(`setup-check: ${errors} error(s), ${warnings} warning(s)`);
}

function relative(cwd: string, filePath: string): string {
  return path.relative(cwd, filePath).replaceAll('\\', '/');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
