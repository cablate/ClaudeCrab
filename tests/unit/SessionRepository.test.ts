import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { DatabaseManager } from '../../src/persistence/DatabaseManager.js';
import { SessionRepository } from '../../src/persistence/SessionRepository.js';
import type { SessionRow } from '../../src/persistence/types.js';

describe('SessionRepository', () => {
  let tempDir: string;
  let dbManager: DatabaseManager;
  let repository: SessionRepository;

  const createTestSession = (overrides: Partial<SessionRow> = {}): SessionRow => ({
    session_id: 'session-1',
    agent_id: 'test-agent',
    platform: 'telegram',
    user_id: 'user-123',
    state: 'idle',
    created_at: '2025-01-01T00:00:00.000Z',
    last_active_at: '2025-01-01T00:00:00.000Z',
    sdk_session_id: null,
    processed_message_ids: '[]',
    ...overrides,
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudecab-repo-'));
    const dbPath = path.join(tempDir, 'test.db');

    dbManager = new DatabaseManager({ dbPath });
    dbManager.initialize();

    repository = new SessionRepository(dbManager.getDatabase());
  });

  afterEach(async () => {
    dbManager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('save', () => {
    it('should save a new session', () => {
      const session = createTestSession();
      repository.save(session);

      const found = repository.findBySessionId('session-1');
      expect(found).toBeDefined();
      expect(found?.session_id).toBe('session-1');
      expect(found?.platform).toBe('telegram');
      expect(found?.user_id).toBe('user-123');
    });

    it('should update existing session (upsert)', () => {
      const session = createTestSession();
      repository.save(session);

      // Update the session
      session.state = 'processing';
      session.last_active_at = '2025-01-01T01:00:00.000Z';
      repository.save(session);

      const found = repository.findBySessionId('session-1');
      expect(found?.state).toBe('processing');
      expect(found?.last_active_at).toBe('2025-01-01T01:00:00.000Z');
    });

    it('should preserve processed message IDs as JSON', () => {
      const session = createTestSession({
        processed_message_ids: '["msg1","msg2","msg3"]',
      });
      repository.save(session);

      const found = repository.findBySessionId('session-1');
      expect(found?.processed_message_ids).toBe('["msg1","msg2","msg3"]');
    });
  });

  describe('findByPlatformAndUser', () => {
    it('should find session by platform and user', () => {
      const session = createTestSession();
      repository.save(session);

      const found = repository.findByPlatformAndUser('telegram', 'user-123');
      expect(found).toBeDefined();
      expect(found?.session_id).toBe('session-1');
    });

    it('should return undefined for non-existent session', () => {
      const found = repository.findByPlatformAndUser('telegram', 'nonexistent');
      expect(found).toBeUndefined();
    });
  });

  describe('findBySessionId', () => {
    it('should find session by ID', () => {
      const session = createTestSession();
      repository.save(session);

      const found = repository.findBySessionId('session-1');
      expect(found).toBeDefined();
      expect(found?.session_id).toBe('session-1');
    });

    it('should return undefined for non-existent session', () => {
      const found = repository.findBySessionId('nonexistent');
      expect(found).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should delete session by ID', () => {
      const session = createTestSession();
      repository.save(session);

      const deleted = repository.delete('session-1');
      expect(deleted).toBe(true);

      const found = repository.findBySessionId('session-1');
      expect(found).toBeUndefined();
    });

    it('should return false for non-existent session', () => {
      const deleted = repository.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('findAll', () => {
    it('should return all sessions ordered by last_active_at DESC', () => {
      repository.save(createTestSession({
        session_id: 'session-1',
        last_active_at: '2025-01-01T00:00:00.000Z',
      }));
      repository.save(createTestSession({
        session_id: 'session-2',
        platform: 'discord',
        user_id: 'user-456',
        last_active_at: '2025-01-01T02:00:00.000Z',
      }));
      repository.save(createTestSession({
        session_id: 'session-3',
        platform: 'telegram',
        user_id: 'user-789',
        last_active_at: '2025-01-01T01:00:00.000Z',
      }));

      const all = repository.findAll();
      expect(all).toHaveLength(3);
      // Most recent first
      expect(all[0]?.session_id).toBe('session-2');
      expect(all[1]?.session_id).toBe('session-3');
      expect(all[2]?.session_id).toBe('session-1');
    });

    it('should return empty array when no sessions', () => {
      const all = repository.findAll();
      expect(all).toHaveLength(0);
    });
  });

  describe('findExpired', () => {
    it('should find sessions older than timeout', () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

      repository.save(createTestSession({
        session_id: 'expired',
        last_active_at: twoHoursAgo.toISOString(),
      }));
      repository.save(createTestSession({
        session_id: 'active',
        platform: 'discord',
        user_id: 'user-456',
        last_active_at: thirtyMinutesAgo.toISOString(),
      }));

      // Find sessions older than 1 hour
      const expired = repository.findExpired(60 * 60 * 1000);
      expect(expired).toHaveLength(1);
      expect(expired[0]?.session_id).toBe('expired');
    });

    it('should return empty array when no expired sessions', () => {
      repository.save(createTestSession({
        last_active_at: new Date().toISOString(),
      }));

      const expired = repository.findExpired(60 * 60 * 1000);
      expect(expired).toHaveLength(0);
    });
  });

  describe('updateState', () => {
    it('should update session state', () => {
      const session = createTestSession();
      repository.save(session);

      repository.updateState('session-1', 'processing');

      const found = repository.findBySessionId('session-1');
      expect(found?.state).toBe('processing');
    });

    it('should update last_active_at when updating state', () => {
      const oldTime = '2025-01-01T00:00:00.000Z';
      const session = createTestSession({ last_active_at: oldTime });
      repository.save(session);

      repository.updateState('session-1', 'processing');

      const found = repository.findBySessionId('session-1');
      expect(found?.last_active_at).not.toBe(oldTime);
    });
  });

  describe('updateLastActive', () => {
    it('should update last_active_at timestamp', () => {
      const oldTime = '2025-01-01T00:00:00.000Z';
      const session = createTestSession({ last_active_at: oldTime });
      repository.save(session);

      repository.updateLastActive('session-1');

      const found = repository.findBySessionId('session-1');
      expect(found?.last_active_at).not.toBe(oldTime);
    });
  });

  describe('updateSdkSessionId', () => {
    it('should update SDK session ID', () => {
      const session = createTestSession();
      repository.save(session);

      repository.updateSdkSessionId('session-1', 'sdk-123');

      const found = repository.findBySessionId('session-1');
      expect(found?.sdk_session_id).toBe('sdk-123');
    });
  });

  describe('updateProcessedMessageIds', () => {
    it('should update processed message IDs', () => {
      const session = createTestSession();
      repository.save(session);

      const messageIds = new Set(['msg1', 'msg2', 'msg3']);
      repository.updateProcessedMessageIds('session-1', messageIds);

      const found = repository.findBySessionId('session-1');
      expect(JSON.parse(found?.processed_message_ids ?? '[]')).toEqual(['msg1', 'msg2', 'msg3']);
    });
  });

  describe('updateAgentId', () => {
    it('should update agent ID and clear SDK session ID', () => {
      const session = createTestSession({ sdk_session_id: 'old-sdk-session' });
      repository.save(session);

      repository.updateAgentId('session-1', 'new-agent');

      const found = repository.findBySessionId('session-1');
      expect(found?.agent_id).toBe('new-agent');
      expect(found?.sdk_session_id).toBeNull();
    });
  });

  describe('count', () => {
    it('should return total session count', () => {
      expect(repository.count()).toBe(0);

      repository.save(createTestSession({ session_id: 'session-1' }));
      expect(repository.count()).toBe(1);

      repository.save(createTestSession({
        session_id: 'session-2',
        platform: 'discord',
        user_id: 'user-456',
      }));
      expect(repository.count()).toBe(2);
    });
  });

  describe('countByPlatform', () => {
    it('should count sessions by platform', () => {
      repository.save(createTestSession({ session_id: 'session-1', platform: 'telegram' }));
      repository.save(createTestSession({
        session_id: 'session-2',
        platform: 'telegram',
        user_id: 'user-456',
      }));
      repository.save(createTestSession({
        session_id: 'session-3',
        platform: 'discord',
        user_id: 'user-789',
      }));

      expect(repository.countByPlatform('telegram')).toBe(2);
      expect(repository.countByPlatform('discord')).toBe(1);
      expect(repository.countByPlatform('line')).toBe(0);
    });
  });

  describe('deleteExpired', () => {
    it('should delete expired sessions and return count', () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      repository.save(createTestSession({
        session_id: 'expired-1',
        last_active_at: twoHoursAgo.toISOString(),
      }));
      repository.save(createTestSession({
        session_id: 'expired-2',
        platform: 'discord',
        user_id: 'user-456',
        last_active_at: twoHoursAgo.toISOString(),
      }));
      repository.save(createTestSession({
        session_id: 'active',
        platform: 'telegram',
        user_id: 'user-789',
        last_active_at: now.toISOString(),
      }));

      const deleted = repository.deleteExpired(60 * 60 * 1000);
      expect(deleted).toBe(2);
      expect(repository.count()).toBe(1);
    });
  });

  describe('unique constraints', () => {
    it('should enforce unique platform + user_id constraint', () => {
      repository.save(createTestSession());

      // Trying to save another session with same platform + user_id but different session_id
      // should throw due to UNIQUE(platform, user_id) constraint
      const duplicate = createTestSession({
        session_id: 'different-session-id',
        state: 'processing',
      });

      // This should throw because of the UNIQUE(platform, user_id) constraint
      // Our save uses ON CONFLICT(session_id), which doesn't handle this case
      expect(() => repository.save(duplicate)).toThrow(/UNIQUE constraint failed/);
    });

    it('should allow same user on different platforms', () => {
      repository.save(createTestSession({
        session_id: 'session-telegram',
        platform: 'telegram',
        user_id: 'user-123',
      }));

      repository.save(createTestSession({
        session_id: 'session-discord',
        platform: 'discord',
        user_id: 'user-123',
      }));

      expect(repository.count()).toBe(2);
    });
  });
});
