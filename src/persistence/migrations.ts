/**
 * Database schema and migration definitions
 *
 * Extracted from DatabaseManager.ts to separate concerns:
 * - Schema SQL for initial database setup
 * - Migration SQL for version upgrades
 * - Migration runner function
 */

import type { Database as DatabaseType } from 'better-sqlite3';
import { logger } from '../utils/logger.js';

/**
 * SQL schema for initializing the database
 */
export const SCHEMA_SQL = `
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
    is_active INTEGER NOT NULL DEFAULT 1,
    continuation_source TEXT DEFAULT NULL,
    continuation_state TEXT DEFAULT NULL,
    UNIQUE (platform, agent_id, user_id)
);

-- Sessions indexes
CREATE INDEX IF NOT EXISTS idx_sessions_platform ON sessions(platform);
CREATE INDEX IF NOT EXISTS idx_sessions_platform_agent_user ON sessions(platform, agent_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active_at);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_continuation ON sessions(continuation_source);

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
    total_cost_cents INTEGER NOT NULL DEFAULT 0,
    num_turns INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    turn_type TEXT DEFAULT 'query',
    sdk_session_id TEXT,
    context_total_tokens INTEGER,
    context_max_tokens INTEGER,
    context_percentage REAL,
    context_model TEXT,
    context_usage_json TEXT
);

-- Query metrics indexes
CREATE INDEX IF NOT EXISTS idx_query_metrics_agent ON query_metrics(agent_id);
CREATE INDEX IF NOT EXISTS idx_query_metrics_created ON query_metrics(created_at);
CREATE INDEX IF NOT EXISTS idx_qm_turn_type ON query_metrics(turn_type);
CREATE INDEX IF NOT EXISTS idx_qm_context_total ON query_metrics(context_total_tokens);

-- Rate limit snapshots table (token-lifecycle-management)
CREATE TABLE IF NOT EXISTS rate_limit_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sdk_session_id TEXT,
    agent_id TEXT,
    rate_limit_type TEXT NOT NULL,
    utilization_pct REAL NOT NULL,
    status TEXT NOT NULL,
    resets_at INTEGER,
    is_using_overage INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rls_type_created ON rate_limit_snapshots(rate_limit_type, created_at);
CREATE INDEX IF NOT EXISTS idx_rls_session ON rate_limit_snapshots(sdk_session_id);

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

export const SCHEMA_VERSION = '14';

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


const MIGRATION_V9_TO_V10 = `
-- Add integer cents column to query_metrics (coexists with total_cost_usd for backward compat)
ALTER TABLE query_metrics ADD COLUMN total_cost_cents INTEGER NOT NULL DEFAULT 0;

-- Backfill from existing USD data
UPDATE query_metrics SET total_cost_cents = ROUND(total_cost_usd * 100) WHERE total_cost_cents = 0 AND total_cost_usd > 0;
`;

const MIGRATION_V10_TO_V11 = `
-- Add is_active column for soft-delete on /reset (survives process restart)
ALTER TABLE sessions ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
`;

const MIGRATION_V12_TO_V13 = `
-- Add turn-level fields to query_metrics for keepalive tracking
ALTER TABLE query_metrics ADD COLUMN turn_type TEXT DEFAULT 'query';
ALTER TABLE query_metrics ADD COLUMN sdk_session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_qm_turn_type ON query_metrics(turn_type);

-- Rate limit snapshots for quota trend persistence
CREATE TABLE IF NOT EXISTS rate_limit_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sdk_session_id TEXT,
    agent_id TEXT,
    rate_limit_type TEXT NOT NULL,
    utilization_pct REAL NOT NULL,
    status TEXT NOT NULL,
    resets_at INTEGER,
    is_using_overage INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rls_type_created ON rate_limit_snapshots(rate_limit_type, created_at);
CREATE INDEX IF NOT EXISTS idx_rls_session ON rate_limit_snapshots(sdk_session_id);
`;

const MIGRATION_V13_TO_V14 = `
-- Allow rate-limit snapshots without a known SDK session id.
CREATE TABLE IF NOT EXISTS rate_limit_snapshots_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sdk_session_id TEXT,
    agent_id TEXT,
    rate_limit_type TEXT NOT NULL,
    utilization_pct REAL NOT NULL,
    status TEXT NOT NULL,
    resets_at INTEGER,
    is_using_overage INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO rate_limit_snapshots_new
SELECT id, sdk_session_id, agent_id, rate_limit_type, utilization_pct, status, resets_at, is_using_overage, created_at
FROM rate_limit_snapshots;

DROP TABLE IF EXISTS rate_limit_snapshots;
ALTER TABLE rate_limit_snapshots_new RENAME TO rate_limit_snapshots;
CREATE INDEX IF NOT EXISTS idx_rls_type_created ON rate_limit_snapshots(rate_limit_type, created_at);
CREATE INDEX IF NOT EXISTS idx_rls_session ON rate_limit_snapshots(sdk_session_id);
`;

/**
 * Migration v14 → v15:
 * Add continuation_source column to sessions table.
 * 'schedule' = pre-created by schedule thread, awaiting user handoff.
 * NULL = normal chat session.
 */
const MIGRATION_V14_TO_V15 = `
ALTER TABLE sessions ADD COLUMN continuation_source TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_continuation ON sessions(continuation_source);
`;

const MIGRATION_V16_TO_V17 = `
-- Store SDK getContextUsage() snapshots alongside query metrics.
ALTER TABLE query_metrics ADD COLUMN context_total_tokens INTEGER;
ALTER TABLE query_metrics ADD COLUMN context_max_tokens INTEGER;
ALTER TABLE query_metrics ADD COLUMN context_percentage REAL;
ALTER TABLE query_metrics ADD COLUMN context_model TEXT;
ALTER TABLE query_metrics ADD COLUMN context_usage_json TEXT;
CREATE INDEX IF NOT EXISTS idx_qm_context_total ON query_metrics(context_total_tokens);
`;

/**
 * Run database migrations from currentVersion to SCHEMA_VERSION
 */
export function runMigrations(db: DatabaseType, currentVersion: string): void {
  logger.info(
    { from: currentVersion, to: SCHEMA_VERSION },
    'Running database migrations'
  );

  if (currentVersion === '1') {
    // Disable foreign keys temporarily for migration
    db.pragma('foreign_keys = OFF');
    db.exec(MIGRATION_V1_TO_V2);
    db.pragma('foreign_keys = ON');
    logger.info('Migration v1 → v2 completed');
    currentVersion = '2';
  }

  if (currentVersion === '2') {
    db.exec(MIGRATION_V2_TO_V3);
    logger.info('Migration v2 → v3 completed');
    currentVersion = '3';
  }

  if (currentVersion === '3') {
    // Disable foreign keys temporarily for migration
    db.pragma('foreign_keys = OFF');
    db.exec(MIGRATION_V3_TO_V4);
    db.pragma('foreign_keys = ON');
    logger.info('Migration v3 → v4 completed');
    currentVersion = '4';
  }

  if (currentVersion === '4') {
    db.exec(MIGRATION_V6_TO_V7);
    logger.info('Migration v4 → v5 completed');
    currentVersion = '5';
  }

  if (currentVersion === '5') {
    db.exec(MIGRATION_V7_TO_V8);
    logger.info('Migration v5 → v6 completed');
    currentVersion = '6';
  }

  if (currentVersion === '6') {
    // execution_records table removed — no-op migration
    logger.info('Migration v6 → v7 completed');
    currentVersion = '7';
  }

  if (currentVersion === '7') {
    db.exec(MIGRATION_V9_TO_V10);
    logger.info('Migration v7 → v8 completed');
    currentVersion = '8';
  }

  if (currentVersion === '8') {
    db.exec(MIGRATION_V10_TO_V11);
    logger.info('Migration v8 → v9 completed');
    currentVersion = '9';
  }

  if (currentVersion === '9') {
    db.exec(MIGRATION_V12_TO_V13);
    logger.info('Migration v9 → v10 completed');
    currentVersion = '10';
  }

  if (currentVersion === '10') {
    db.exec(MIGRATION_V13_TO_V14);
    logger.info('Migration v10 → v11 completed');
    currentVersion = '11';
  }

  if (currentVersion === '11') {
    db.exec(MIGRATION_V14_TO_V15);
    logger.info('Migration v11 → v12 completed');
    currentVersion = '12';
  }

  if (currentVersion === '12') {
    db.exec(`ALTER TABLE sessions ADD COLUMN continuation_state TEXT DEFAULT NULL;`);
    logger.info('Migration v12 → v13 completed');
    currentVersion = '13';
  }

  if (currentVersion === '13') {
    db.exec(MIGRATION_V16_TO_V17);
    logger.info('Migration v13 → v14 completed');
    currentVersion = '14';
  }

  // Update schema version
  const updateStmt = db.prepare(
    'UPDATE metadata SET value = ?, updated_at = ? WHERE key = ?'
  );
  updateStmt.run(SCHEMA_VERSION, new Date().toISOString(), 'schema_version');
  logger.info({ version: SCHEMA_VERSION }, 'Schema version updated');
}
