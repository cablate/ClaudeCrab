/**
 * Centralized application configuration.
 * All environment variable parsing happens here to avoid scattered parseInt/defaults.
 */

/**
 * Application configuration loaded from environment variables.
 */
export interface AppConfig {
  persistence: {
    enabled: boolean;
    dbPath: string;
  };
  session: {
    timeoutMs: number;
    cleanupIntervalMs: number;
    maxSessions: number;
    dbRetentionMs: number;
  };
  webui: {
    enabled: boolean;
    port: number;
    /** WebUI login password */
    password?: string;
    /** JWT signing secret */
    jwtSecret?: string;
    /** Session expiration in milliseconds */
    sessionExpireMs?: number;
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
}

/**
 * Load and validate application configuration from environment variables.
 * Called once at startup before any initialization.
 */
export function loadAppConfig(): AppConfig {
  return {
    persistence: {
      enabled: process.env.ENABLE_PERSISTENCE === 'true',
      dbPath: process.env.DB_PATH ?? './data/claudecab.db',
    },
    session: {
      timeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS ?? '3600000', 10),
      cleanupIntervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS ?? '60000', 10),
      maxSessions: parseInt(process.env.MAX_SESSIONS ?? '1000', 10),
      dbRetentionMs: parseInt(process.env.DB_RETENTION_MS ?? '2592000000', 10), // 30 days
    },
    webui: {
      enabled: process.env.WEBUI_ENABLED === 'true',
      port: parseInt(process.env.WEBUI_PORT ?? '3001', 10),
      ...(process.env.WEBUI_PASSWORD !== undefined ? { password: process.env.WEBUI_PASSWORD } : {}),
      ...(process.env.WEBUI_JWT_SECRET !== undefined ? { jwtSecret: process.env.WEBUI_JWT_SECRET } : {}),
      ...(process.env.WEBUI_SESSION_EXPIRE !== undefined
        ? { sessionExpireMs: parseInt(process.env.WEBUI_SESSION_EXPIRE, 10) }
        : {}),
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
      dashboardUpdateMinutes: parseInt(process.env.DISCORD_DASHBOARD_UPDATE_MINUTES ?? '15', 10),
      ...(process.env.DISCORD_OWNER_USER_ID !== undefined ? { ownerUserId: process.env.DISCORD_OWNER_USER_ID } : {}),
    },
    security: {
      ...(process.env.ALLOWED_USERS !== undefined ? { allowedUsers: process.env.ALLOWED_USERS } : {}),
      ...(process.env.MAX_MESSAGE_LENGTH !== undefined
        ? { maxMessageLength: parseInt(process.env.MAX_MESSAGE_LENGTH, 10) }
        : {}),
      promptInjectionDetection: process.env.PROMPT_INJECTION_DETECTION === 'true',
    },
    audit: {
      enabled: process.env.AUDIT_LOGGING !== 'false',
    },
  };
}
