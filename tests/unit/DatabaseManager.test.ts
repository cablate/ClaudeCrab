import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { DatabaseManager } from '../../src/persistence/DatabaseManager.js';

describe('DatabaseManager', () => {
  let tempDir: string;
  let dbManager: DatabaseManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudecab-db-'));
  });

  afterEach(async () => {
    if (dbManager !== undefined) {
      dbManager.close();
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('should create database file', async () => {
      const dbPath = path.join(tempDir, 'test.db');
      dbManager = new DatabaseManager({ dbPath });
      dbManager.initialize();

      const exists = await fs.access(dbPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should create database directory if not exists', async () => {
      const dbPath = path.join(tempDir, 'subdir', 'nested', 'test.db');
      dbManager = new DatabaseManager({ dbPath });
      dbManager.initialize();

      const exists = await fs.access(dbPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should create required tables', () => {
      const dbPath = path.join(tempDir, 'test.db');
      dbManager = new DatabaseManager({ dbPath });
      dbManager.initialize();

      const db = dbManager.getDatabase();

      // Check sessions table exists
      const sessionsTable = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
      ).get();
      expect(sessionsTable).toBeDefined();

      // Check conversations table exists
      const conversationsTable = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'"
      ).get();
      expect(conversationsTable).toBeDefined();

      // Check metadata table exists
      const metadataTable = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'"
      ).get();
      expect(metadataTable).toBeDefined();
    });

    it('should enable WAL mode by default', () => {
      const dbPath = path.join(tempDir, 'test.db');
      dbManager = new DatabaseManager({ dbPath });
      dbManager.initialize();

      const db = dbManager.getDatabase();
      const journalMode = db.pragma('journal_mode', { simple: true });
      expect(journalMode).toBe('wal');
    });

    it('should be idempotent (safe to call multiple times)', () => {
      const dbPath = path.join(tempDir, 'test.db');
      dbManager = new DatabaseManager({ dbPath });

      dbManager.initialize();
      dbManager.initialize(); // Should not throw

      expect(dbManager.isInitialized()).toBe(true);
    });

    it('should set schema version in metadata', () => {
      const dbPath = path.join(tempDir, 'test.db');
      dbManager = new DatabaseManager({ dbPath });
      dbManager.initialize();

      const db = dbManager.getDatabase();
      const row = db.prepare(
        "SELECT value FROM metadata WHERE key = 'schema_version'"
      ).get() as { value: string } | undefined;

      expect(row).toBeDefined();
      expect(row?.value).toBe('6');
    });
  });

  describe('getDatabase', () => {
    it('should return database instance after initialization', () => {
      const dbPath = path.join(tempDir, 'test.db');
      dbManager = new DatabaseManager({ dbPath });
      dbManager.initialize();

      const db = dbManager.getDatabase();
      expect(db).toBeDefined();
    });

    it('should throw if not initialized', () => {
      const dbPath = path.join(tempDir, 'test.db');
      dbManager = new DatabaseManager({ dbPath });

      expect(() => dbManager.getDatabase()).toThrow('Database not initialized');
    });
  });

  describe('isInitialized', () => {
    it('should return false before initialization', () => {
      const dbPath = path.join(tempDir, 'test.db');
      dbManager = new DatabaseManager({ dbPath });

      expect(dbManager.isInitialized()).toBe(false);
    });

    it('should return true after initialization', () => {
      const dbPath = path.join(tempDir, 'test.db');
      dbManager = new DatabaseManager({ dbPath });
      dbManager.initialize();

      expect(dbManager.isInitialized()).toBe(true);
    });

    it('should return false after close', () => {
      const dbPath = path.join(tempDir, 'test.db');
      dbManager = new DatabaseManager({ dbPath });
      dbManager.initialize();
      dbManager.close();

      expect(dbManager.isInitialized()).toBe(false);
    });
  });

  describe('close', () => {
    it('should close database connection', () => {
      const dbPath = path.join(tempDir, 'test.db');
      dbManager = new DatabaseManager({ dbPath });
      dbManager.initialize();
      dbManager.close();

      expect(dbManager.isInitialized()).toBe(false);
    });

    it('should be safe to call multiple times', () => {
      const dbPath = path.join(tempDir, 'test.db');
      dbManager = new DatabaseManager({ dbPath });
      dbManager.initialize();

      dbManager.close();
      dbManager.close(); // Should not throw

      expect(dbManager.isInitialized()).toBe(false);
    });
  });

  describe('getDbPath', () => {
    it('should return configured database path', () => {
      const dbPath = path.join(tempDir, 'custom-path.db');
      dbManager = new DatabaseManager({ dbPath });

      expect(dbManager.getDbPath()).toBe(dbPath);
    });
  });

  describe('transaction', () => {
    it('should execute function within transaction', () => {
      const dbPath = path.join(tempDir, 'test.db');
      dbManager = new DatabaseManager({ dbPath });
      dbManager.initialize();

      const db = dbManager.getDatabase();

      // Create a test table
      db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)');

      const result = dbManager.transaction(() => {
        db.prepare('INSERT INTO test (value) VALUES (?)').run('test1');
        db.prepare('INSERT INTO test (value) VALUES (?)').run('test2');
        return db.prepare('SELECT COUNT(*) as count FROM test').get() as { count: number };
      });

      expect(result.count).toBe(2);
    });

    it('should rollback on error', () => {
      const dbPath = path.join(tempDir, 'test.db');
      dbManager = new DatabaseManager({ dbPath });
      dbManager.initialize();

      const db = dbManager.getDatabase();
      db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');

      try {
        dbManager.transaction(() => {
          db.prepare('INSERT INTO test (value) VALUES (?)').run('test1');
          db.prepare('INSERT INTO test (value) VALUES (?)').run(null); // This should fail
        });
      } catch {
        // Expected to throw
      }

      const result = db.prepare('SELECT COUNT(*) as count FROM test').get() as { count: number };
      expect(result.count).toBe(0); // Rolled back
    });
  });

  describe('foreign keys', () => {
    it('should enforce foreign key constraints', () => {
      const dbPath = path.join(tempDir, 'test.db');
      dbManager = new DatabaseManager({ dbPath });
      dbManager.initialize();

      const db = dbManager.getDatabase();

      // Try to insert conversation without session (should fail due to FK constraint)
      expect(() => {
        db.prepare(`
          INSERT INTO conversations (session_id, role, content, created_at, sequence_number)
          VALUES ('nonexistent', 'user', 'test', '2025-01-01T00:00:00.000Z', 1)
        `).run();
      }).toThrow();
    });
  });

  describe('indexes', () => {
    it('should create indexes on sessions table', () => {
      const dbPath = path.join(tempDir, 'test.db');
      dbManager = new DatabaseManager({ dbPath });
      dbManager.initialize();

      const db = dbManager.getDatabase();
      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sessions'"
      ).all() as { name: string }[];

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain('idx_sessions_platform');
      expect(indexNames).toContain('idx_sessions_platform_agent_user');
      expect(indexNames).toContain('idx_sessions_last_active');
    });

    it('should create indexes on conversations table', () => {
      const dbPath = path.join(tempDir, 'test.db');
      dbManager = new DatabaseManager({ dbPath });
      dbManager.initialize();

      const db = dbManager.getDatabase();
      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='conversations'"
      ).all() as { name: string }[];

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain('idx_conversations_session');
      expect(indexNames).toContain('idx_conversations_session_seq');
    });
  });
});
