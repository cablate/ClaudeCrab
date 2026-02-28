/**
 * Database connection manager for SQLite persistence
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';
import { SCHEMA_SQL, SCHEMA_VERSION, runMigrations } from './migrations.js';
import type { PersistenceConfig } from './types.js';
import { DEFAULT_PERSISTENCE_CONFIG } from './types.js';

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
    runMigrations(this.db, currentVersion);
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
