import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { DatabaseManager } from '../../src/persistence/DatabaseManager.js';
import { SessionRepository } from '../../src/persistence/SessionRepository.js';
import { ConversationRepository } from '../../src/persistence/ConversationRepository.js';
import type { SessionRow } from '../../src/persistence/types.js';

describe('ConversationRepository', () => {
  let tempDir: string;
  let dbManager: DatabaseManager;
  let sessionRepo: SessionRepository;
  let conversationRepo: ConversationRepository;

  const testSession: SessionRow = {
    session_id: 'session-1',
    agent_id: 'test-agent',
    platform: 'telegram',
    user_id: 'user-123',
    state: 'idle',
    created_at: '2025-01-01T00:00:00.000Z',
    last_active_at: '2025-01-01T00:00:00.000Z',
    sdk_session_id: null,
    processed_message_ids: '[]',
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudecab-conv-'));
    const dbPath = path.join(tempDir, 'test.db');

    dbManager = new DatabaseManager({ dbPath });
    dbManager.initialize();

    sessionRepo = new SessionRepository(dbManager.getDatabase());
    conversationRepo = new ConversationRepository(dbManager.getDatabase());

    // Create test session for foreign key
    sessionRepo.save(testSession);
  });

  afterEach(async () => {
    dbManager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('appendMessage', () => {
    it('should append message with correct sequence number', () => {
      conversationRepo.appendMessage('session-1', 'user', 'Hello');
      conversationRepo.appendMessage('session-1', 'assistant', 'Hi there!');
      conversationRepo.appendMessage('session-1', 'user', 'How are you?');

      const messages = conversationRepo.findBySessionId('session-1');
      expect(messages).toHaveLength(3);
      expect(messages[0]?.sequence_number).toBe(1);
      expect(messages[1]?.sequence_number).toBe(2);
      expect(messages[2]?.sequence_number).toBe(3);
    });

    it('should preserve message content', () => {
      conversationRepo.appendMessage('session-1', 'user', 'Hello, world!');

      const messages = conversationRepo.findBySessionId('session-1');
      expect(messages[0]?.role).toBe('user');
      expect(messages[0]?.content).toBe('Hello, world!');
    });

    it('should handle special characters in content', () => {
      const specialContent = 'Hello "world"! 日本語 🎉 \n\t special chars';
      conversationRepo.appendMessage('session-1', 'user', specialContent);

      const messages = conversationRepo.findBySessionId('session-1');
      expect(messages[0]?.content).toBe(specialContent);
    });

    it('should set created_at timestamp', () => {
      conversationRepo.appendMessage('session-1', 'user', 'Hello');

      const messages = conversationRepo.findBySessionId('session-1');
      expect(messages[0]?.created_at).toBeDefined();
      expect(new Date(messages[0]?.created_at ?? '').getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('findBySessionId', () => {
    it('should return messages ordered by sequence number', () => {
      conversationRepo.appendMessage('session-1', 'user', 'First');
      conversationRepo.appendMessage('session-1', 'assistant', 'Second');
      conversationRepo.appendMessage('session-1', 'user', 'Third');

      const messages = conversationRepo.findBySessionId('session-1');
      expect(messages.map((m) => m.content)).toEqual(['First', 'Second', 'Third']);
    });

    it('should return empty array for non-existent session', () => {
      const messages = conversationRepo.findBySessionId('nonexistent');
      expect(messages).toHaveLength(0);
    });

    it('should return empty array for session with no messages', () => {
      const messages = conversationRepo.findBySessionId('session-1');
      expect(messages).toHaveLength(0);
    });
  });

  describe('clearConversation', () => {
    it('should delete all messages for a session', () => {
      conversationRepo.appendMessage('session-1', 'user', 'Hello');
      conversationRepo.appendMessage('session-1', 'assistant', 'Hi');
      conversationRepo.appendMessage('session-1', 'user', 'Bye');

      conversationRepo.clearConversation('session-1');

      const messages = conversationRepo.findBySessionId('session-1');
      expect(messages).toHaveLength(0);
    });

    it('should not affect other sessions', () => {
      // Create another session
      sessionRepo.save({
        ...testSession,
        session_id: 'session-2',
        user_id: 'user-456',
      });

      conversationRepo.appendMessage('session-1', 'user', 'Session 1 message');
      conversationRepo.appendMessage('session-2', 'user', 'Session 2 message');

      conversationRepo.clearConversation('session-1');

      expect(conversationRepo.findBySessionId('session-1')).toHaveLength(0);
      expect(conversationRepo.findBySessionId('session-2')).toHaveLength(1);
    });

    it('should handle non-existent session gracefully', () => {
      expect(() => conversationRepo.clearConversation('nonexistent')).not.toThrow();
    });
  });

  describe('getMessageCount', () => {
    it('should return correct message count', () => {
      expect(conversationRepo.getMessageCount('session-1')).toBe(0);

      conversationRepo.appendMessage('session-1', 'user', 'Hello');
      expect(conversationRepo.getMessageCount('session-1')).toBe(1);

      conversationRepo.appendMessage('session-1', 'assistant', 'Hi');
      expect(conversationRepo.getMessageCount('session-1')).toBe(2);
    });

    it('should return 0 for non-existent session', () => {
      expect(conversationRepo.getMessageCount('nonexistent')).toBe(0);
    });
  });

  describe('getLastMessages', () => {
    it('should return last N messages in order', () => {
      for (let i = 1; i <= 5; i++) {
        conversationRepo.appendMessage('session-1', 'user', `Message ${i}`);
      }

      const last3 = conversationRepo.getLastMessages('session-1', 3);
      expect(last3).toHaveLength(3);
      // Should be in ascending order (Message 3, 4, 5)
      expect(last3[0]?.content).toBe('Message 3');
      expect(last3[1]?.content).toBe('Message 4');
      expect(last3[2]?.content).toBe('Message 5');
    });

    it('should return all messages if count exceeds total', () => {
      conversationRepo.appendMessage('session-1', 'user', 'Hello');
      conversationRepo.appendMessage('session-1', 'assistant', 'Hi');

      const messages = conversationRepo.getLastMessages('session-1', 10);
      expect(messages).toHaveLength(2);
    });

    it('should return empty array for non-existent session', () => {
      const messages = conversationRepo.getLastMessages('nonexistent', 5);
      expect(messages).toHaveLength(0);
    });
  });

  describe('cascade delete', () => {
    it('should delete conversations when session is deleted', () => {
      conversationRepo.appendMessage('session-1', 'user', 'Hello');
      conversationRepo.appendMessage('session-1', 'assistant', 'Hi');

      expect(conversationRepo.getMessageCount('session-1')).toBe(2);

      sessionRepo.delete('session-1');

      // Messages should be automatically deleted due to CASCADE
      expect(conversationRepo.getMessageCount('session-1')).toBe(0);
    });
  });
});
