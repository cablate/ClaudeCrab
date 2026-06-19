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
const SUPPORTED_MODELS = ['sonnet', 'opus', 'haiku'];

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
    checks.push({ level: 'error', area: 'agents', message: `AGENTS_DIR does not exist or is not a directory: ${agentsDir}` });
  } else {
    checks.push({ level: 'ok', area: 'agents', message: `AGENTS_DIR exists: ${agentsDir}` });
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
      message: `${relative(cwd, claudeMdPath)} is missing; the agent will run without a project instruction file.`,
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
        ? '.env.example is missing, so template setup cannot be checked.'
        : '.env is missing. Run "cp .env.example .env", then fill the required values.',
    });
  } else {
    checks.push({ level: 'ok', area: '.env', message: `${relative(cwd, envPath)} exists` });
  }

  if (!existsSync(envExamplePath)) {
    checks.push({ level: 'warn', area: '.env.example', message: '.env.example is missing; new users will not have a setup template.' });
  }
}

function checkRequiredEnv(env: Record<string, string>, checks: Check[], templateMode: boolean): void {
  requireEnv(env, 'DISCORD_ENABLED', checks, undefined, templateMode);
  if (env.DISCORD_ENABLED !== 'true') {
    checks.push({ level: 'error', area: '.env', message: 'DISCORD_ENABLED must be true for the Discord runtime to start.' });
  }
  requireEnv(env, 'DISCORD_MAIN_BOT_TOKEN', checks, undefined, templateMode);
  requireEnv(env, 'DISCORD_MAIN_BOT_CLIENT_ID', checks, isDiscordId, templateMode);
  requireEnv(env, 'DISCORD_GUILD_ID', checks, isDiscordId, templateMode);
  requireEnv(env, 'AGENTS_DIR', checks, undefined, templateMode);
  checkDiscordEnvShape(env, checks, templateMode);
  checkOptionalDiscordOwnerUserId(env, checks, templateMode);
}

function checkNodeVersion(nodeVersion: string, checks: Check[]): void {
  const majorText = nodeVersion.split('.')[0] ?? '';
  const major = Number.parseInt(majorText, 10);
  if (!Number.isFinite(major)) {
    checks.push({ level: 'warn', area: 'node', message: `Could not parse Node.js version: ${nodeVersion}` });
    return;
  }
  if (major < 20) {
    checks.push({ level: 'error', area: 'node', message: `Node.js 20+ is required. Current version: ${nodeVersion}` });
    return;
  }
  checks.push({ level: 'ok', area: 'node', message: `Node.js version is supported: ${nodeVersion}` });
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

  if (typeof agentConfig.model === 'string') {
    if (!SUPPORTED_MODELS.includes(agentConfig.model)) {
      checks.push({ level: 'error', area: 'agent.json', message: `model must be one of: ${SUPPORTED_MODELS.join(', ')}.` });
    }
  } else {
    checks.push({ level: 'warn', area: 'agent.json', message: 'model is not set; runtime defaults will apply.' });
  }
}

function checkClaudeSettings(settings: Record<string, unknown>, checks: Check[]): void {
  const envValue = settings.env;
  if (envValue !== undefined && (typeof envValue !== 'object' || envValue === null || Array.isArray(envValue))) {
    checks.push({ level: 'error', area: '.claude/settings.local.json', message: 'env must be an object.' });
  }
  if (typeof settings.model === 'string' && !SUPPORTED_MODELS.includes(settings.model)) {
    checks.push({ level: 'error', area: '.claude/settings.local.json', message: `model must be one of: ${SUPPORTED_MODELS.join(', ')}.` });
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
      message: 'DISCORD_MAIN_BOT_TOKEN looks like a Discord ID. Paste the bot token from Developer Portal > Bot > Token.',
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
        message: `${key} looks like a bot token. Enable Discord Developer Mode and copy the numeric ID instead.`,
      });
    }
  }

  if (!isPlaceholder(mainClientId) && !isPlaceholder(guildId) && mainClientId === guildId) {
    checks.push({
      level: 'error',
      area: 'discord',
      message: 'DISCORD_MAIN_BOT_CLIENT_ID equals DISCORD_GUILD_ID. Client ID is the application ID; guild ID is the server ID.',
    });
  }
}

function checkOptionalDiscordOwnerUserId(env: Record<string, string>, checks: Check[], templateMode: boolean): void {
  const ownerUserId = env.DISCORD_OWNER_USER_ID ?? '';
  if (isPlaceholder(ownerUserId)) {
    if (templateMode) {
      checks.push({ level: 'ok', area: '.env', message: 'DISCORD_OWNER_USER_ID is optional.' });
    }
    return;
  }
  if (DISCORD_TOKEN_HINT.test(ownerUserId)) {
    checks.push({
      level: 'error',
      area: '.env',
      message: 'DISCORD_OWNER_USER_ID looks like a bot token. Enable Discord Developer Mode and copy your numeric user ID.',
    });
    return;
  }
  if (!isDiscordId(ownerUserId)) {
    checks.push({
      level: 'error',
      area: '.env',
      message: 'DISCORD_OWNER_USER_ID must be a numeric Discord user ID when set.',
    });
    return;
  }
  checks.push({ level: 'ok', area: '.env', message: 'DISCORD_OWNER_USER_ID is set' });
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
      message: 'agent discordBotToken looks like a Discord ID. Paste the agent bot token from Developer Portal > Bot > Token.',
    });
  }
  if (!templateMode && !isPlaceholder(channelId) && DISCORD_TOKEN_HINT.test(channelId)) {
    checks.push({
      level: 'error',
      area: 'discord',
      message: 'agent discordChannelId looks like a bot token. Enable Discord Developer Mode and copy the numeric channel ID.',
    });
  }

  if (isPlaceholder(mainBotToken) || isPlaceholder(agentBotToken)) {
    if (templateMode) {
      checks.push({ level: 'ok', area: 'discord', message: 'Template keeps main bot and agent bot tokens as placeholders.' });
    }
  } else if (mainBotToken === agentBotToken) {
    checks.push({
      level: 'error',
      area: 'discord',
      message: 'DISCORD_MAIN_BOT_TOKEN equals agent discordBotToken. Use separate bots for production, or confirm this is intentional before continuing.',
    });
  } else {
    checks.push({ level: 'ok', area: 'discord', message: 'Main bot token and agent bot token are distinct.' });
  }

  if (!isPlaceholder(guildId) && !isPlaceholder(channelId) && guildId === channelId) {
    checks.push({
      level: 'error',
      area: 'discord',
      message: 'DISCORD_GUILD_ID equals agent discordChannelId. Server ID and channel ID are different values.',
    });
  }
  if (!isPlaceholder(mainClientId) && !isPlaceholder(channelId) && mainClientId === channelId) {
    checks.push({
      level: 'error',
      area: 'discord',
      message: 'DISCORD_MAIN_BOT_CLIENT_ID equals agent discordChannelId. Application ID and channel ID are different values.',
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
    checks.push({ level: 'error', area, message: `${relative(cwd, filePath)} is missing.` });
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      checks.push({ level: 'error', area, message: `${relative(cwd, filePath)} must be a JSON object.` });
      return undefined;
    }
    checks.push({ level: 'ok', area, message: `${relative(cwd, filePath)} is valid JSON` });
    return parsed as Record<string, unknown>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    checks.push({ level: 'error', area, message: `${relative(cwd, filePath)} has invalid JSON: ${reason}` });
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
        ? `${key} is blank or a placeholder; template mode allows it.`
        : `${key} is required and cannot be blank or a placeholder.`,
    });
    return;
  }
  if (validator && !validator(value)) {
    checks.push({
      level: 'error',
      area: '.env',
      message: `${key} must be a numeric Discord ID. Enable Developer Mode and copy the correct ID.`,
    });
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
      message: allowPlaceholder
        ? `${key} is blank or a placeholder; template mode allows it.`
        : `${key} is required and cannot be blank or a placeholder.`,
    });
    return;
  }
  if (validator && !validator(value)) {
    checks.push({
      level: 'error',
      area,
      message: `${key} must be a numeric Discord ID. Enable Developer Mode and copy the correct ID.`,
    });
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

  if (!isPlaceholder(agentBaseUrl)) {
    checks.push({
      level: 'error',
      area: 'auth',
      message: 'Agent-level ANTHROPIC_BASE_URL is set but agent env has no ANTHROPIC_API_KEY.',
    });
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
