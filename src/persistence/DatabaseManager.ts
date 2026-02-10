/**
 * Database connection manager for SQLite persistence
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';
import type { PersistenceConfig } from './types.js';
import { DEFAULT_PERSISTENCE_CONFIG } from './types.js';

/**
 * SQL schema for initializing the database
 */
const SCHEMA_SQL = `
-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    user_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('idle', 'processing', 'error')),
    created_at TEXT NOT NULL,
    last_active_at TEXT NOT NULL,
    sdk_session_id TEXT,
    processed_message_ids TEXT NOT NULL DEFAULT '[]',
    UNIQUE (platform, agent_id, user_id)
);

-- Sessions indexes
CREATE INDEX IF NOT EXISTS idx_sessions_platform ON sessions(platform);
CREATE INDEX IF NOT EXISTS idx_sessions_platform_agent_user ON sessions(platform, agent_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active_at);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    sequence_number INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

-- Conversations indexes
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_session_seq ON conversations(session_id, sequence_number);

-- Metadata table for schema versioning
CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Scheduled tasks table
CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    trigger_type TEXT NOT NULL,
    trigger_config TEXT NOT NULL,
    execution_config TEXT NOT NULL,
    notification_config TEXT,
    enabled INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Scheduled tasks indexes
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_agent ON scheduled_tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled ON scheduled_tasks(enabled);

-- Schedule executions table (no FK - YAML files are source of truth)
CREATE TABLE IF NOT EXISTS schedule_executions (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    success INTEGER,
    duration_ms INTEGER,
    result_summary TEXT,
    error_message TEXT
);

-- Schedule executions indexes
CREATE INDEX IF NOT EXISTS idx_schedule_executions_schedule ON schedule_executions(schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedule_executions_started ON schedule_executions(started_at);

-- Group messages table (shared across bots for context injection)
CREATE TABLE IF NOT EXISTS group_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    platform_msg_id TEXT NOT NULL,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'bot')),
    sender_id TEXT NOT NULL,
    sender_label TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(platform, chat_id, platform_msg_id)
);

-- Group messages indexes
CREATE INDEX IF NOT EXISTS idx_group_messages_chat ON group_messages(platform, chat_id);
CREATE INDEX IF NOT EXISTS idx_group_messages_lookup ON group_messages(platform, chat_id, platform_msg_id);

-- Group injection state table (tracks injection cursor per bot per group)
CREATE TABLE IF NOT EXISTS group_injection_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    joined_msg_id TEXT,
    last_injected_msg_id TEXT,
    last_injected_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(platform, agent_id, chat_id)
);

-- Group injection state indexes
CREATE INDEX IF NOT EXISTS idx_injection_state_lookup ON group_injection_state(platform, agent_id, chat_id);

-- Group members table (persistent group membership for bots, ADR-020)
CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(platform, chat_id, agent_id)
);

-- Group members indexes
CREATE INDEX IF NOT EXISTS idx_group_members_chat ON group_members(platform, chat_id);
CREATE INDEX IF NOT EXISTS idx_group_members_agent ON group_members(agent_id);

-- Query metrics table (ADR-020 Phase 2: token usage tracking)
CREATE TABLE IF NOT EXISTS query_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_usd REAL NOT NULL DEFAULT 0,
    num_turns INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

-- Query metrics indexes
CREATE INDEX IF NOT EXISTS idx_query_metrics_agent ON query_metrics(agent_id);
CREATE INDEX IF NOT EXISTS idx_query_metrics_created ON query_metrics(created_at);

-- Activity events table (v2.0)
CREATE TABLE IF NOT EXISTS activity_events (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    type TEXT NOT NULL,
    phase TEXT,
    message TEXT NOT NULL,
    mood TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_events_agent ON activity_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_type ON activity_events(type);
CREATE INDEX IF NOT EXISTS idx_activity_events_created ON activity_events(created_at);
`;

const SCHEMA_VERSION = '8';

/**
 * Migration SQL from v1 to v2:
 * Changes UNIQUE constraint from (platform, user_id) to (platform, agent_id, user_id)
 */
const MIGRATION_V1_TO_V2 = `
-- Recreate sessions table with new UNIQUE constraint
CREATE TABLE IF NOT EXISTS sessions_new (
    session_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    user_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('idle', 'processing', 'error')),
    created_at TEXT NOT NULL,
    last_active_at TEXT NOT NULL,
    sdk_session_id TEXT,
    processed_message_ids TEXT NOT NULL DEFAULT '[]',
    UNIQUE (platform, agent_id, user_id)
);

-- Copy existing data
INSERT OR IGNORE INTO sessions_new SELECT * FROM sessions;

-- Drop old table and rename
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_sessions_platform ON sessions(platform);
CREATE INDEX IF NOT EXISTS idx_sessions_platform_agent_user ON sessions(platform, agent_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active_at);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
`;

/**
 * Migration SQL from v2 to v3:
 * Adds scheduled_tasks and schedule_executions tables
 */
const MIGRATION_V2_TO_V3 = `
-- Scheduled tasks table
CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    trigger_type TEXT NOT NULL,
    trigger_config TEXT NOT NULL,
    execution_config TEXT NOT NULL,
    notification_config TEXT,
    enabled INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Scheduled tasks indexes
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_agent ON scheduled_tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled ON scheduled_tasks(enabled);

-- Schedule executions table (no FK - YAML files are source of truth)
CREATE TABLE IF NOT EXISTS schedule_executions (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    success INTEGER,
    duration_ms INTEGER,
    result_summary TEXT,
    error_message TEXT
);

-- Schedule executions indexes
CREATE INDEX IF NOT EXISTS idx_schedule_executions_schedule ON schedule_executions(schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedule_executions_started ON schedule_executions(started_at);
`;

/**
 * Migration SQL from v3 to v4:
 * Removes foreign key from schedule_executions (YAML files are source of truth)
 */
const MIGRATION_V3_TO_V4 = `
-- Recreate schedule_executions without foreign key
CREATE TABLE IF NOT EXISTS schedule_executions_new (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    success INTEGER,
    duration_ms INTEGER,
    result_summary TEXT,
    error_message TEXT
);

-- Copy existing data
INSERT OR IGNORE INTO schedule_executions_new SELECT * FROM schedule_executions;

-- Drop old table and rename
DROP TABLE IF EXISTS schedule_executions;
ALTER TABLE schedule_executions_new RENAME TO schedule_executions;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_schedule_executions_schedule ON schedule_executions(schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedule_executions_started ON schedule_executions(started_at);
`;

/**
 * Migration SQL from v4 to v5:
 * Adds group_messages and group_injection_state tables for multi-bot context injection
 */
const MIGRATION_V4_TO_V5 = `
-- Group messages table (shared across bots for context injection)
CREATE TABLE IF NOT EXISTS group_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    platform_msg_id TEXT NOT NULL,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'bot')),
    sender_id TEXT NOT NULL,
    sender_label TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(platform, chat_id, platform_msg_id)
);

-- Group messages indexes
CREATE INDEX IF NOT EXISTS idx_group_messages_chat ON group_messages(platform, chat_id);
CREATE INDEX IF NOT EXISTS idx_group_messages_lookup ON group_messages(platform, chat_id, platform_msg_id);

-- Group injection state table (tracks injection cursor per bot per group)
CREATE TABLE IF NOT EXISTS group_injection_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    joined_msg_id TEXT,
    last_injected_msg_id TEXT,
    last_injected_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(platform, agent_id, chat_id)
);

-- Group injection state indexes
CREATE INDEX IF NOT EXISTS idx_injection_state_lookup ON group_injection_state(platform, agent_id, chat_id);
`;

/**
 * Migration SQL from v5 to v6:
 * Adds group_members table for persistent group membership (ADR-020)
 */
const MIGRATION_V5_TO_V6 = `
-- Group members table (persistent group membership for bots, ADR-020)
CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(platform, chat_id, agent_id)
);

-- Group members indexes
CREATE INDEX IF NOT EXISTS idx_group_members_chat ON group_members(platform, chat_id);
CREATE INDEX IF NOT EXISTS idx_group_members_agent ON group_members(agent_id);
`;

/**
 * Migration SQL from v6 to v7:
 * Adds query_metrics table for token usage tracking (ADR-020 Phase 2)
 */
const MIGRATION_V6_TO_V7 = `
-- Query metrics table (ADR-020 Phase 2: token usage tracking)
CREATE TABLE IF NOT EXISTS query_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_usd REAL NOT NULL DEFAULT 0,
    num_turns INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

-- Query metrics indexes
CREATE INDEX IF NOT EXISTS idx_query_metrics_agent ON query_metrics(agent_id);
CREATE INDEX IF NOT EXISTS idx_query_metrics_created ON query_metrics(created_at);
`;

const MIGRATION_V7_TO_V8 = `
-- Activity events table (v2.0: workflow visibility + personality reactions)
CREATE TABLE IF NOT EXISTS activity_events (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    type TEXT NOT NULL,
    phase TEXT,
    message TEXT NOT NULL,
    mood TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_events_agent ON activity_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_type ON activity_events(type);
CREATE INDEX IF NOT EXISTS idx_activity_events_created ON activity_events(created_at);
`;

/**
 * Database manager options
 */
export interface DatabaseManagerOptions {
  /** Path to the SQLite database file */
  dbPath?: string;

  /** Enable WAL mode (default: true) */
  walMode?: boolean;
}

/**
 * Manages SQLite database connection and initialization
 */
export class DatabaseManager {
  private db: DatabaseType | null = null;
  private readonly config: PersistenceConfig;
  private initialized = false;
  private checkpointTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly CHECKPOINT_INTERVAL_MS = 30_000;

  constructor(options: DatabaseManagerOptions = {}) {
    this.config = {
      ...DEFAULT_PERSISTENCE_CONFIG,
      enabled: true,
      dbPath: options.dbPath ?? DEFAULT_PERSISTENCE_CONFIG.dbPath,
      walMode: options.walMode ?? DEFAULT_PERSISTENCE_CONFIG.walMode,
    };
  }

  /**
   * Initialize the database connection and schema
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    // Ensure directory exists
    const dbDir = path.dirname(this.config.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      logger.debug({ dbDir }, 'Created database directory');
    }

    // Open database connection
    this.db = new Database(this.config.dbPath);

    // Enable WAL mode for better concurrency
    if (this.config.walMode) {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('wal_autocheckpoint = 100');
      logger.debug('WAL mode enabled (autocheckpoint=100 pages)');
    }

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    // Initialize schema
    this.initializeSchema();

    // Start periodic WAL checkpoint
    if (this.config.walMode) {
      this.startCheckpointTimer();
    }

    this.initialized = true;
    logger.info({ dbPath: this.config.dbPath }, 'Database initialized');
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    if (this.db === null) {
      throw new Error('Database not connected');
    }

    // Execute schema SQL
    this.db.exec(SCHEMA_SQL);

    // Check and update schema version
    const versionStmt = this.db.prepare(
      'SELECT value FROM metadata WHERE key = ?'
    );
    const row = versionStmt.get('schema_version') as { value: string } | undefined;

    if (row === undefined) {
      // Insert initial version
      const insertStmt = this.db.prepare(
        'INSERT INTO metadata (key, value, updated_at) VALUES (?, ?, ?)'
      );
      insertStmt.run('schema_version', SCHEMA_VERSION, new Date().toISOString());
      logger.debug({ version: SCHEMA_VERSION }, 'Schema version initialized');
    } else if (row.value !== SCHEMA_VERSION) {
      this.runMigrations(row.value);
    }
  }

  /**
   * Run database migrations from currentVersion to SCHEMA_VERSION
   */
  private runMigrations(currentVersion: string): void {
    if (this.db === null) {
      throw new Error('Database not connected');
    }

    logger.info(
      { from: currentVersion, to: SCHEMA_VERSION },
      'Running database migrations'
    );

    if (currentVersion === '1') {
      // Disable foreign keys temporarily for migration
      this.db.pragma('foreign_keys = OFF');
      this.db.exec(MIGRATION_V1_TO_V2);
      this.db.pragma('foreign_keys = ON');
      logger.info('Migration v1 → v2 completed');
      currentVersion = '2';
    }

    if (currentVersion === '2') {
      this.db.exec(MIGRATION_V2_TO_V3);
      logger.info('Migration v2 → v3 completed');
      currentVersion = '3';
    }

    if (currentVersion === '3') {
      // Disable foreign keys temporarily for migration
      this.db.pragma('foreign_keys = OFF');
      this.db.exec(MIGRATION_V3_TO_V4);
      this.db.pragma('foreign_keys = ON');
      logger.info('Migration v3 → v4 completed');
      currentVersion = '4';
    }

    if (currentVersion === '4') {
      this.db.exec(MIGRATION_V4_TO_V5);
      logger.info('Migration v4 → v5 completed');
      currentVersion = '5';
    }

    if (currentVersion === '5') {
      this.db.exec(MIGRATION_V5_TO_V6);
      logger.info('Migration v5 → v6 completed');
      currentVersion = '6';
    }

    if (currentVersion === '6') {
      this.db.exec(MIGRATION_V6_TO_V7);
      logger.info('Migration v6 → v7 completed');
      currentVersion = '7';
    }

    if (currentVersion === '7') {
      this.db.exec(MIGRATION_V7_TO_V8);
      logger.info('Migration v7 → v8 completed');
    }

    // Update schema version
    const updateStmt = this.db.prepare(
      'UPDATE metadata SET value = ?, updated_at = ? WHERE key = ?'
    );
    updateStmt.run(SCHEMA_VERSION, new Date().toISOString(), 'schema_version');
    logger.info({ version: SCHEMA_VERSION }, 'Schema version updated');
  }

  /**
   * Get the database instance
   */
  getDatabase(): DatabaseType {
    if (this.db === null) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.stopCheckpointTimer();
    if (this.db !== null) {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      this.db.close();
      this.db = null;
      this.initialized = false;
      logger.info('Database connection closed (WAL checkpointed)');
    }
  }

  private startCheckpointTimer(): void {
    this.checkpointTimer = setInterval(() => {
      if (this.db !== null) {
        try {
          this.db.pragma('wal_checkpoint(PASSIVE)');
        } catch {
          // DB may have been closed between check and pragma
        }
      }
    }, DatabaseManager.CHECKPOINT_INTERVAL_MS);
    this.checkpointTimer.unref();
  }

  private stopCheckpointTimer(): void {
    if (this.checkpointTimer !== null) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = null;
    }
  }

  /**
   * Get the database file path
   */
  getDbPath(): string {
    return this.config.dbPath;
  }

  /**
   * Execute a function within a transaction
   */
  transaction<T>(fn: () => T): T {
    if (this.db === null) {
      throw new Error('Database not initialized');
    }
    return this.db.transaction(fn)();
  }
}
