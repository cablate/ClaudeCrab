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
  };
}
