/**
 * Centralized application configuration.
 * All environment variable parsing happens here to avoid scattered parseInt/defaults.
 */

import * as path from 'node:path';

/**
 * Application configuration loaded from environment variables.
 */
export interface AppConfig {
  agentsDir: string;
  persistence: {
    enabled: boolean;
    dbPath: string;
  };
  session: {
    timeoutMs: number;
    cleanupIntervalMs: number;
    maxSessions: number;
    dbRetentionMs: number;
    /** Destroy the SDK CLI process after each query to free ~150MB RAM.
     *  Resume data stays on disk so the next query can restore context via JSONL. */
    ephemeral: boolean;
  };
  schedule: {
    enabled: boolean;
  };
  stt: {
    enabled: boolean;
    provider: 'groq';
    apiKey: string;
    model: string;
  };
  tts: {
    enabled: boolean;
    provider: 'replicate';
    apiToken: string;
    model: string;
    defaultVoiceId: string;
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
      approvals: string;
      costReport: string;
      alerts: string;
      taskBoard: string;
      systemLog: string;
    };
    /** Dashboard update interval in minutes */
    dashboardUpdateMinutes: number;
    /** Discord owner user ID for DM notifications */
    ownerUserId?: string;
    /** When false, hides in-chat tool status messages ("✓ 已完成 N 個操作") and usage summary card (cache/tokens/cost embed) after each query */
    inChatUsageSummary: boolean;
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

function parseIntegerEnv(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function parseFloatEnv(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

/**
 * Load and validate application configuration from environment variables.
 * Called once at startup before any initialization.
 */
export function loadAppConfig(): AppConfig {
  return {
    agentsDir: process.env.AGENTS_DIR ?? path.resolve(process.cwd(), 'agents'),
    persistence: {
      enabled: process.env.ENABLE_PERSISTENCE === 'true',
      dbPath: process.env.DB_PATH ?? './data/claudecab.db',
    },
    session: {
      timeoutMs: parseIntegerEnv('SESSION_TIMEOUT_MS', 3_600_000),
      cleanupIntervalMs: parseIntegerEnv('CLEANUP_INTERVAL_MS', 60_000),
      maxSessions: parseIntegerEnv('MAX_SESSIONS', 1000),
      dbRetentionMs: parseIntegerEnv('DB_RETENTION_MS', 2_592_000_000), // 30 days
      ephemeral: process.env.SESSION_EPHEMERAL === 'true',
    },
    schedule: {
      enabled: process.env.SCHEDULE_ENABLED !== 'false', // Default enabled
    },
    stt: {
      enabled: process.env.STT_ENABLED === 'true',
      provider: (process.env.STT_PROVIDER ?? 'groq') as 'groq',
      apiKey: process.env.STT_API_KEY ?? '',
      model: process.env.STT_MODEL ?? 'whisper-large-v3-turbo',
    },
    tts: {
      enabled: process.env.TTS_ENABLED === 'true',
      provider: (process.env.TTS_PROVIDER ?? 'replicate') as 'replicate',
      apiToken: process.env.REPLICATE_API_TOKEN ?? '',
      model: process.env.TTS_MODEL ?? 'minimax/speech-2.8-turbo',
      defaultVoiceId: process.env.TTS_DEFAULT_VOICE_ID ?? '',
    },
    discord: {
      enabled: process.env.DISCORD_ENABLED === 'true',
      mainBotToken: process.env.DISCORD_MAIN_BOT_TOKEN ?? '',
      mainBotClientId: process.env.DISCORD_MAIN_BOT_CLIENT_ID ?? '',
      guildId: process.env.DISCORD_GUILD_ID ?? '',
      channels: {
        dashboard: process.env.DISCORD_CHANNEL_DASHBOARD ?? '',
        approvals: process.env.DISCORD_CHANNEL_APPROVALS ?? '',
        costReport: process.env.DISCORD_CHANNEL_COST_REPORT ?? '',
        alerts: process.env.DISCORD_CHANNEL_ALERTS ?? '',
        taskBoard: process.env.DISCORD_CHANNEL_TASK_BOARD ?? '',
        systemLog: process.env.DISCORD_CHANNEL_SYSTEM_LOG ?? '',
      },
      dashboardUpdateMinutes: parseIntegerEnv('DISCORD_DASHBOARD_UPDATE_MINUTES', 15),
      inChatUsageSummary: process.env.IN_CHAT_USAGE_SUMMARY_ENABLED !== 'false',
      ...(process.env.DISCORD_OWNER_USER_ID !== undefined ? { ownerUserId: process.env.DISCORD_OWNER_USER_ID } : {}),
    },
    security: {
      ...(process.env.ALLOWED_USERS !== undefined ? { allowedUsers: process.env.ALLOWED_USERS } : {}),
      ...(process.env.MAX_MESSAGE_LENGTH !== undefined
        ? { maxMessageLength: parseIntegerEnv('MAX_MESSAGE_LENGTH', 10_000) }
        : {}),
      promptInjectionDetection: process.env.PROMPT_INJECTION_DETECTION === 'true',
    },
    audit: {
      enabled: process.env.AUDIT_LOGGING !== 'false',
    },
    sessionGuard: {
      enabled: process.env.SESSION_GUARD_ENABLED !== 'false',
      tokenThreshold: parseIntegerEnv('SESSION_GUARD_TOKEN_THRESHOLD', 150_000),
      cacheTTLMs: parseIntegerEnv('SESSION_GUARD_CACHE_TTL_MS', 300_000),
    },
    cacheKeepalive: {
      enabled: process.env.CACHE_KEEPALIVE_ENABLED !== 'false',
      intervalMs: parseIntegerEnv('CACHE_KEEPALIVE_INTERVAL_MS', DEFAULT_CACHE_KEEPALIVE_CONFIG.intervalMs),
      skipRecentMs: parseIntegerEnv('CACHE_KEEPALIVE_SKIP_RECENT_MS', DEFAULT_CACHE_KEEPALIVE_CONFIG.skipRecentMs),
      detectedTTLRatio: parseFloatEnv('CACHE_KEEPALIVE_DETECTED_TTL_RATIO', DEFAULT_CACHE_KEEPALIVE_CONFIG.detectedTTLRatio),
      minIntervalMs: parseIntegerEnv('CACHE_KEEPALIVE_MIN_INTERVAL_MS', DEFAULT_CACHE_KEEPALIVE_CONFIG.minIntervalMs),
      queryingRetryMs: parseIntegerEnv('CACHE_KEEPALIVE_QUERYING_RETRY_MS', DEFAULT_CACHE_KEEPALIVE_CONFIG.queryingRetryMs),
      alertCooldownMs: parseIntegerEnv('CACHE_KEEPALIVE_ALERT_COOLDOWN_MS', DEFAULT_CACHE_KEEPALIVE_CONFIG.alertCooldownMs),
      efficiencyWarnThreshold: parseIntegerEnv('CACHE_EFFICIENCY_WARN_THRESHOLD', DEFAULT_CACHE_KEEPALIVE_CONFIG.efficiencyWarnThreshold),
      postQueryWarmupMs: parseIntegerEnv('CACHE_KEEPALIVE_POST_QUERY_WARMUP_MS', DEFAULT_CACHE_KEEPALIVE_CONFIG.postQueryWarmupMs),
    },
  };
}
