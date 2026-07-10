/**
 * Centralized application configuration.
 * All environment variable parsing happens here to avoid scattered parseInt/defaults.
 */

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { setDisplayTimezone } from './utils/timezone.js';
import { setDisplayLocale } from './utils/locale.js';

/**
 * Application configuration loaded from environment variables.
 */
export interface AppConfig {
  agentsDir: string;
  /** IANA timezone used for human-facing time display (dashboard, crash notices, prompt context). Defaults to UTC. */
  displayTimezone: string;
  /** Display locale tag (e.g. en, zh-TW) for human-facing labels and date formatting. Defaults to en. */
  displayLocale: string;
  persistence: {
    enabled: boolean;
    dbPath: string;
  };
  session: {
    timeoutMs: number;
    cleanupIntervalMs: number;
    maxSessions: number;
    dbRetentionMs: number;
    /** Close the live SDK CLI process after this much real-query idle time.
     *  The app session and sdkSessionId are preserved for later resume. */
    idleCloseMs: number;
    /** Interrupt active SDK queries that exceed this runtime. 0 disables. */
    queryHardTimeoutMs: number;
    /** After timeout interrupt, force-close the live SDK process after this grace period. */
    queryHardTimeoutGraceMs: number;
    /** Destroy the SDK CLI process after each query to free ~150MB RAM.
     *  Resume data stays on disk so the next query can restore context via JSONL. */
    ephemeral: boolean;
  };
  schedule: {
    enabled: boolean;
    catchUpEnabled: boolean;
    catchUpCheckIntervalMs: number;
    catchUpGraceMs: number;
    catchUpWindowMs: number;
    staleRunningMs: number;
  };
  stt: {
    enabled: boolean;
    provider: 'groq';
    apiKey: string;
    model: string;
  };
  discord: {
    enabled: boolean;
    /** Main Bot token (handles slash commands, system embeds, interactions) */
    mainBotToken: string;
    /** Main Bot client ID (for slash command registration) */
    mainBotClientId: string;
    /** Discord Guild (server) ID */
    guildId: string;
    /** System channel IDs */
    channels: {
      dashboard: string;
      costReport: string;
      alerts: string;
      systemLog: string;
    };
    /** Dashboard update interval in minutes */
    dashboardUpdateMinutes: number;
    /** Discord owner user ID for DM notifications */
    ownerUserId?: string;
    /** When false, hides in-chat tool status messages ("✓ 已完成 N 個操作") */
    inChatUsageSummary: boolean;
    /** When false, hides the per-turn usage summary card (cache/tokens/cost embed) at the end of each query */
    usageCardEnabled: boolean;
  };
  security?: {
    /** Comma-separated list of allowed user IDs (empty = allow all) */
    allowedUsers?: string;
    /** Maximum message length in characters */
    maxMessageLength?: number;
    /** Whether to enable prompt injection detection */
    promptInjectionDetection?: boolean;
  };
  audit?: {
    /** Whether audit logging is enabled (default: true) */
    enabled?: boolean;
  };
  admin: {
    /** Small operator console for setup/config/restart. Disabled by default. */
    enabled: boolean;
    /** Bind host. Defaults to localhost for safety. */
    host: string;
    /** Bind port. */
    port: number;
    /** Writable local config overlay used by the admin console. */
    localConfigPath: string;
    /** Bearer token required for admin API calls. */
    token?: string;
    /** Run npm run build before restart. */
    restartBuildCheckEnabled: boolean;
  };
  sessionGuard: {
    /** Whether session-length-handoff-guard is enabled (default: true) */
    enabled: boolean;
    /** Context token count to trigger session-too-long warning (default: 300000) */
    tokenThreshold: number;
    /** Idle time in ms after which cache is considered expired (default: 5 min) */
    cacheTTLMs: number;
  };
  cacheKeepalive: CacheKeepaliveConfig;
}

export interface CacheKeepaliveConfig {
  /** Master switch for the keepalive ping loop. When false, no pings are scheduled. */
  enabled: boolean;
  /** Initial keepalive interval before the API reveals the cache TTL tier. */
  intervalMs: number;
  /** Skip a ping when the user just interacted and the cache is still young. */
  skipRecentMs: number;
  /** Fraction of detected TTL to use as the keepalive interval. 0.2 => 1 min for 5 min TTL. */
  detectedTTLRatio: number;
  /** Lower bound for detected-TTL-derived intervals. */
  minIntervalMs: number;
  /** Retry cadence while a user query is still running. */
  queryingRetryMs: number;
  /** Alert cooldown for repeated keepalive cache anomalies. */
  alertCooldownMs: number;
  /** Cache hit percentage below which a keepalive ping is considered anomalous. */
  efficiencyWarnThreshold: number;
  /** Delay before the first keepalive after a real query completes (cache warmup). */
  postQueryWarmupMs: number;
}

export const DEFAULT_CACHE_KEEPALIVE_CONFIG: CacheKeepaliveConfig = {
  enabled: true,
  intervalMs: 60 * 1000,
  skipRecentMs: 15 * 1000,
  detectedTTLRatio: 0.6,
  minIntervalMs: 30 * 1000,
  queryingRetryMs: 15 * 1000,
  alertCooldownMs: 60 * 60 * 1000,
  efficiencyWarnThreshold: 50,
  postQueryWarmupMs: 5 * 1000,
};

type EnvSource = NodeJS.ProcessEnv;

function optionalString(env: EnvSource, name: string): string | undefined {
  const raw = env[name];
  return raw === undefined || raw === '' ? undefined : raw;
}

function integerFromEnv(env: EnvSource, name: string, fallback: number, min = 0): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function floatFromEnv(env: EnvSource, name: string, fallback: number, min = 0): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function envFlag(env: EnvSource, name: string, enabledValue = 'true'): boolean {
  return env[name] === enabledValue;
}

function envEnabledByDefault(env: EnvSource, name: string): boolean {
  return env[name] !== 'false';
}

const CacheKeepaliveSchema = z.object({
  enabled: z.boolean(),
  intervalMs: z.number().int().min(0),
  skipRecentMs: z.number().int().min(0),
  detectedTTLRatio: z.number().min(0),
  minIntervalMs: z.number().int().min(0),
  queryingRetryMs: z.number().int().min(0),
  alertCooldownMs: z.number().int().min(0),
  efficiencyWarnThreshold: z.number().int().min(0),
  postQueryWarmupMs: z.number().int().min(0),
}) satisfies z.ZodType<CacheKeepaliveConfig>;

const AppConfigSchema = z.object({
  agentsDir: z.string().min(1),
  displayTimezone: z.string().min(1),
  displayLocale: z.string().min(1),
  persistence: z.object({
    enabled: z.boolean(),
    dbPath: z.string().min(1),
  }),
  session: z.object({
    timeoutMs: z.number().int().min(0),
    cleanupIntervalMs: z.number().int().min(0),
    maxSessions: z.number().int().min(0),
    dbRetentionMs: z.number().int().min(0),
    idleCloseMs: z.number().int().min(0),
    queryHardTimeoutMs: z.number().int().min(0),
    queryHardTimeoutGraceMs: z.number().int().min(0),
    ephemeral: z.boolean(),
  }),
  schedule: z.object({
    enabled: z.boolean(),
    catchUpEnabled: z.boolean(),
    catchUpCheckIntervalMs: z.number().int().min(0),
    catchUpGraceMs: z.number().int().min(0),
    catchUpWindowMs: z.number().int().min(0),
    staleRunningMs: z.number().int().min(0),
  }),
  stt: z.object({
    enabled: z.boolean(),
    provider: z.literal('groq'),
    apiKey: z.string(),
    model: z.string().min(1),
  }),
  discord: z.object({
    enabled: z.boolean(),
    mainBotToken: z.string(),
    mainBotClientId: z.string(),
    guildId: z.string(),
    channels: z.object({
      dashboard: z.string(),
      costReport: z.string(),
      alerts: z.string(),
      systemLog: z.string(),
    }),
    dashboardUpdateMinutes: z.number().int().min(0),
    ownerUserId: z.string().optional(),
    inChatUsageSummary: z.boolean(),
    usageCardEnabled: z.boolean(),
  }),
  security: z.object({
    allowedUsers: z.string().optional(),
    maxMessageLength: z.number().int().min(1).optional(),
    promptInjectionDetection: z.boolean().optional(),
  }).optional(),
  audit: z.object({
    enabled: z.boolean().optional(),
  }).optional(),
  admin: z.object({
    enabled: z.boolean(),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    localConfigPath: z.string().min(1),
    token: z.string().optional(),
    restartBuildCheckEnabled: z.boolean(),
  }),
  sessionGuard: z.object({
    enabled: z.boolean(),
    tokenThreshold: z.number().int().min(0),
    cacheTTLMs: z.number().int().min(0),
  }),
  cacheKeepalive: CacheKeepaliveSchema,
});

export interface RuntimeConfigIssue {
  path: string;
  message: string;
  envVars: string[];
}

export interface RuntimeConfigValidation {
  ok: boolean;
  issues: RuntimeConfigIssue[];
}

function addOptional<T extends Record<string, unknown>, K extends string, V>(
  target: T,
  key: K,
  value: V | undefined
): asserts target is T & Partial<Record<K, V>> {
  if (value !== undefined) {
    Object.assign(target, { [key]: value });
  }
}

function buildRawAppConfig(env: EnvSource, cwd: string): AppConfig {
  const adminToken = optionalString(env, 'ADMIN_CONSOLE_TOKEN');
  const discordConfig: AppConfig['discord'] = {
    enabled: envFlag(env, 'DISCORD_ENABLED'),
    mainBotToken: env.DISCORD_MAIN_BOT_TOKEN ?? '',
    mainBotClientId: env.DISCORD_MAIN_BOT_CLIENT_ID ?? '',
    guildId: env.DISCORD_GUILD_ID ?? '',
    channels: {
      dashboard: env.DISCORD_CHANNEL_DASHBOARD ?? '',
      costReport: env.DISCORD_CHANNEL_COST_REPORT ?? '',
      alerts: env.DISCORD_CHANNEL_ALERTS ?? '',
      systemLog: env.DISCORD_CHANNEL_SYSTEM_LOG ?? '',
    },
    dashboardUpdateMinutes: integerFromEnv(env, 'DISCORD_DASHBOARD_UPDATE_MINUTES', 15),
    inChatUsageSummary: envEnabledByDefault(env, 'IN_CHAT_USAGE_SUMMARY_ENABLED'),
    usageCardEnabled: envEnabledByDefault(env, 'USAGE_CARD_ENABLED'),
  };
  addOptional(discordConfig, 'ownerUserId', optionalString(env, 'DISCORD_OWNER_USER_ID'));

  const securityConfig: NonNullable<AppConfig['security']> = {
    promptInjectionDetection: envFlag(env, 'PROMPT_INJECTION_DETECTION'),
  };
  addOptional(securityConfig, 'allowedUsers', optionalString(env, 'ALLOWED_USERS'));
  if (env.MAX_MESSAGE_LENGTH !== undefined && env.MAX_MESSAGE_LENGTH !== '') {
    securityConfig.maxMessageLength = integerFromEnv(env, 'MAX_MESSAGE_LENGTH', 10_000, 1);
  }

  return {
    agentsDir: env.AGENTS_DIR ?? path.resolve(cwd, 'agents'),
    displayTimezone: optionalString(env, 'DISPLAY_TIMEZONE') ?? 'UTC',
    displayLocale: optionalString(env, 'DISPLAY_LOCALE') ?? 'en',
    persistence: {
      enabled: envFlag(env, 'ENABLE_PERSISTENCE'),
      dbPath: env.DB_PATH ?? './data/claudecab.db',
    },
    session: {
      timeoutMs: integerFromEnv(env, 'SESSION_TIMEOUT_MS', 3_600_000),
      cleanupIntervalMs: integerFromEnv(env, 'CLEANUP_INTERVAL_MS', 60_000),
      maxSessions: integerFromEnv(env, 'MAX_SESSIONS', 1000),
      dbRetentionMs: integerFromEnv(env, 'DB_RETENTION_MS', 2_592_000_000),
      idleCloseMs: integerFromEnv(env, 'SESSION_IDLE_CLOSE_MS', 7_200_000),
      queryHardTimeoutMs: integerFromEnv(env, 'SESSION_QUERY_HARD_TIMEOUT_MS', 3_600_000),
      queryHardTimeoutGraceMs: integerFromEnv(env, 'SESSION_QUERY_HARD_TIMEOUT_GRACE_MS', 30_000),
      ephemeral: envFlag(env, 'SESSION_EPHEMERAL'),
    },
    schedule: {
      enabled: envEnabledByDefault(env, 'SCHEDULE_ENABLED'),
      catchUpEnabled: envEnabledByDefault(env, 'SCHEDULE_CATCHUP_ENABLED'),
      catchUpCheckIntervalMs: integerFromEnv(env, 'SCHEDULE_CATCHUP_CHECK_INTERVAL_MS', 1_800_000),
      catchUpGraceMs: integerFromEnv(env, 'SCHEDULE_CATCHUP_GRACE_MS', 1_800_000),
      catchUpWindowMs: integerFromEnv(env, 'SCHEDULE_CATCHUP_WINDOW_MS', 10_800_000),
      staleRunningMs: integerFromEnv(env, 'SCHEDULE_STALE_RUNNING_MS', 7_200_000),
    },
    stt: {
      enabled: envFlag(env, 'STT_ENABLED'),
      provider: 'groq',
      apiKey: env.STT_API_KEY ?? '',
      model: env.STT_MODEL ?? 'whisper-large-v3-turbo',
    },
    discord: discordConfig,
    security: securityConfig,
    audit: {
      enabled: envEnabledByDefault(env, 'AUDIT_LOGGING'),
    },
    admin: {
      enabled: envFlag(env, 'ADMIN_CONSOLE_ENABLED'),
      host: env.ADMIN_CONSOLE_HOST ?? '127.0.0.1',
      port: integerFromEnv(env, 'ADMIN_CONSOLE_PORT', 47_824, 1),
      localConfigPath: path.resolve(cwd, env.CLAUDECAB_LOCAL_CONFIG_PATH ?? './data/claudecab.local.json'),
      restartBuildCheckEnabled: envEnabledByDefault(env, 'ADMIN_RESTART_BUILD_CHECK_ENABLED'),
      ...(adminToken !== undefined ? { token: adminToken } : {}),
    },
    sessionGuard: {
      enabled: envEnabledByDefault(env, 'SESSION_GUARD_ENABLED'),
      tokenThreshold: integerFromEnv(env, 'SESSION_GUARD_TOKEN_THRESHOLD', 150_000),
      cacheTTLMs: integerFromEnv(env, 'SESSION_GUARD_CACHE_TTL_MS', 300_000),
    },
    cacheKeepalive: {
      enabled: envEnabledByDefault(env, 'CACHE_KEEPALIVE_ENABLED'),
      intervalMs: integerFromEnv(env, 'CACHE_KEEPALIVE_INTERVAL_MS', DEFAULT_CACHE_KEEPALIVE_CONFIG.intervalMs),
      skipRecentMs: integerFromEnv(env, 'CACHE_KEEPALIVE_SKIP_RECENT_MS', DEFAULT_CACHE_KEEPALIVE_CONFIG.skipRecentMs),
      detectedTTLRatio: floatFromEnv(env, 'CACHE_KEEPALIVE_DETECTED_TTL_RATIO', DEFAULT_CACHE_KEEPALIVE_CONFIG.detectedTTLRatio),
      minIntervalMs: integerFromEnv(env, 'CACHE_KEEPALIVE_MIN_INTERVAL_MS', DEFAULT_CACHE_KEEPALIVE_CONFIG.minIntervalMs),
      queryingRetryMs: integerFromEnv(env, 'CACHE_KEEPALIVE_QUERYING_RETRY_MS', DEFAULT_CACHE_KEEPALIVE_CONFIG.queryingRetryMs),
      alertCooldownMs: integerFromEnv(env, 'CACHE_KEEPALIVE_ALERT_COOLDOWN_MS', DEFAULT_CACHE_KEEPALIVE_CONFIG.alertCooldownMs),
      efficiencyWarnThreshold: integerFromEnv(env, 'CACHE_EFFICIENCY_WARN_THRESHOLD', DEFAULT_CACHE_KEEPALIVE_CONFIG.efficiencyWarnThreshold),
      postQueryWarmupMs: integerFromEnv(env, 'CACHE_KEEPALIVE_POST_QUERY_WARMUP_MS', DEFAULT_CACHE_KEEPALIVE_CONFIG.postQueryWarmupMs),
    },
  };
}

/**
 * Load and validate application configuration from environment variables.
 * Called once at startup before any initialization.
 */
export function loadAppConfig(env: EnvSource = process.env, cwd: string = process.cwd()): AppConfig {
  const config = buildRawAppConfig(mergeLocalConfig(env, cwd), cwd);
  AppConfigSchema.parse(config);
  setDisplayTimezone(config.displayTimezone);
  setDisplayLocale(config.displayLocale);
  return config;
}

function mergeLocalConfig(env: EnvSource, cwd: string): EnvSource {
  const localPath = path.resolve(cwd, env.CLAUDECAB_LOCAL_CONFIG_PATH ?? './data/claudecab.local.json');
  if (!existsSync(localPath)) return env;
  const parsed = JSON.parse(readFileSync(localPath, 'utf-8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Local config overlay must be a JSON object: ${localPath}`);
  }
  const overlay: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      overlay[key] = String(value);
    }
  }
  return { ...env, ...overlay };
}

export function validateAppConfigForRuntime(config: AppConfig): RuntimeConfigValidation {
  const issues: RuntimeConfigIssue[] = [];

  if (config.discord.enabled) {
    if (!config.discord.mainBotToken) {
      issues.push({
        path: 'discord.mainBotToken',
        message: 'Discord 啟用時必須設定主 Bot token。',
        envVars: ['DISCORD_MAIN_BOT_TOKEN'],
      });
    }
    if (!config.discord.mainBotClientId) {
      issues.push({
        path: 'discord.mainBotClientId',
        message: 'Discord 啟用時必須設定主 Bot client ID，slash command 註冊會用到。',
        envVars: ['DISCORD_MAIN_BOT_CLIENT_ID'],
      });
    }
  }

  if (config.admin.enabled) {
    if (config.admin.token === undefined || config.admin.token.length < 16) {
      issues.push({
        path: 'admin.token',
        message: 'Admin console enabled but ADMIN_CONSOLE_TOKEN is missing or shorter than 16 characters.',
        envVars: ['ADMIN_CONSOLE_TOKEN'],
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function formatRuntimeConfigIssues(issues: RuntimeConfigIssue[]): string {
  if (issues.length === 0) return '';
  const lines = issues.map((issue) => {
    const envList = issue.envVars.join(', ');
    return `- ${issue.path}: ${issue.message} 請設定 ${envList}`;
  });
  return ['ClaudeCrab configuration is incomplete:', ...lines].join('\n');
}
