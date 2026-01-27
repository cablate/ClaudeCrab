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
    UNIQUE (platform, user_id)
);

-- Sessions indexes
CREATE INDEX IF NOT EXISTS idx_sessions_platform ON sessions(platform);
CREATE INDEX IF NOT EXISTS idx_sessions_platform_user ON sessions(platform, user_id);
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
`;

const SCHEMA_VERSION = '1';

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
      logger.debug('WAL mode enabled');
    }

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    // Initialize schema
    this.initializeSchema();

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
      // Future: handle migrations here
      logger.warn(
        { currentVersion: row.value, targetVersion: SCHEMA_VERSION },
        'Schema version mismatch, migration may be needed'
      );
    }
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
    if (this.db !== null) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      logger.info('Database connection closed');
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
