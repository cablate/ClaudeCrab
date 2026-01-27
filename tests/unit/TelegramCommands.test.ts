import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from 'grammy';
import {
  handleStart,
  handleHelp,
  handleList,
  handleSwitch,
  handleReset,
  type CommandDependencies,
} from '../../src/adapters/commands/TelegramCommands.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('TelegramCommands', () => {
  let mockContext: Partial<Context>;
  let mockDeps: CommandDependencies;
  let replyMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    replyMock = vi.fn().mockResolvedValue(undefined);

    mockContext = {
      from: {
        id: 12345,
        is_bot: false,
        first_name: 'Test',
        last_name: 'User',
      },
      message: {
        text: '',
        message_id: 1,
        date: Date.now() / 1000,
        chat: {
          id: 12345,
          type: 'private',
        },
      } as Context['message'],
      reply: replyMock,
    };

    const mockAgents: Record<string, { config: { name: string; description?: string } }> = {
      default: { config: { name: 'Default Agent', description: 'General assistant' } },
      coder: { config: { name: 'Code Assistant', description: 'Coding helper' } },
      writer: { config: { name: 'Writer', description: 'Writing assistant' } },
    };

    mockDeps = {
      agentLoader: {
        list: vi.fn().mockReturnValue(['default', 'coder', 'writer']),
        scanAgents: vi.fn().mockResolvedValue(['default', 'coder', 'writer']),
        get: vi.fn().mockImplementation((id: string) => mockAgents[id]),
        loadAgent: vi.fn().mockImplementation((id: string) => Promise.resolve(mockAgents[id])),
      },
      sessionManager: {
        getOrCreateSession: vi.fn().mockResolvedValue({
          sessionId: 'test-session-123',
          agentId: 'default',
          agent: { config: { name: 'Default Agent' } },
        }),
        switchAgent: vi.fn().mockResolvedValue(undefined),
      },
      messageProcessor: {
        clearConversation: vi.fn(),
      },
      defaultAgentId: 'default',
    };
  });

  describe('handleStart', () => {
    it('should send welcome message', async () => {
      await handleStart(mockContext as Context, mockDeps);

      expect(replyMock).toHaveBeenCalledTimes(1);
      expect(replyMock.mock.calls[0][0]).toContain('你好 Test');
      expect(replyMock.mock.calls[0][0]).toContain('Default Agent');
    });

    it('should create session on start', async () => {
      await handleStart(mockContext as Context, mockDeps);

      expect(mockDeps.sessionManager.getOrCreateSession).toHaveBeenCalledWith({
        platform: 'telegram',
        userId: '12345',
        agentId: 'default',
      });
    });

    it('should handle missing user', async () => {
      mockContext.from = undefined;

      await handleStart(mockContext as Context, mockDeps);

      expect(replyMock).not.toHaveBeenCalled();
    });

    it('should handle session creation error', async () => {
      (mockDeps.sessionManager.getOrCreateSession as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Session error'));

      await handleStart(mockContext as Context, mockDeps);

      expect(replyMock).toHaveBeenCalledWith('抱歉，初始化失敗。請稍後再試。');
    });
  });

  describe('handleHelp', () => {
    it('should send help message', async () => {
      await handleHelp(mockContext as Context, mockDeps);

      expect(replyMock).toHaveBeenCalledTimes(1);
      expect(replyMock.mock.calls[0][0]).toContain('幫助訊息');
      expect(replyMock.mock.calls[0][0]).toContain('/start');
      expect(replyMock.mock.calls[0][0]).toContain('/help');
      expect(replyMock.mock.calls[0][0]).toContain('/list');
      expect(replyMock.mock.calls[0][0]).toContain('/switch');
      expect(replyMock.mock.calls[0][0]).toContain('/reset');
    });

    it('should show current agent', async () => {
      await handleHelp(mockContext as Context, mockDeps);

      expect(replyMock.mock.calls[0][0]).toContain('Default Agent');
    });
  });

  describe('handleList', () => {
    it('should list all agents', async () => {
      await handleList(mockContext as Context, mockDeps);

      expect(replyMock).toHaveBeenCalledTimes(1);
      const message = replyMock.mock.calls[0][0] as string;
      expect(message).toContain('Default Agent');
      expect(message).toContain('Code Assistant');
      expect(message).toContain('Writer');
    });

    it('should mark current agent', async () => {
      await handleList(mockContext as Context, mockDeps);

      const message = replyMock.mock.calls[0][0] as string;
      expect(message).toContain('✅');
    });

    it('should handle empty agent list', async () => {
      (mockDeps.agentLoader.scanAgents as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await handleList(mockContext as Context, mockDeps);

      expect(replyMock).toHaveBeenCalledWith('目前沒有可用的代理。');
    });
  });

  describe('handleSwitch', () => {
    it('should switch to specified agent', async () => {
      mockContext.message!.text = '/switch coder';

      await handleSwitch(mockContext as Context, mockDeps);

      expect(mockDeps.sessionManager.switchAgent).toHaveBeenCalledWith(
        'telegram',
        '12345',
        'coder'
      );
      expect(mockDeps.messageProcessor.clearConversation).toHaveBeenCalled();
      expect(replyMock.mock.calls[0][0]).toContain('Code Assistant');
    });

    it('should show error for missing agent argument', async () => {
      mockContext.message!.text = '/switch';

      await handleSwitch(mockContext as Context, mockDeps);

      expect(replyMock.mock.calls[0][0]).toContain('請指定要切換的代理');
      expect(mockDeps.sessionManager.switchAgent).not.toHaveBeenCalled();
    });

    it('should show error for unknown agent', async () => {
      mockContext.message!.text = '/switch unknown';
      // scanAgents returns available agents, 'unknown' is not in the list

      await handleSwitch(mockContext as Context, mockDeps);

      expect(replyMock.mock.calls[0][0]).toContain('找不到代理');
      expect(mockDeps.sessionManager.switchAgent).not.toHaveBeenCalled();
    });

    it('should handle switch error', async () => {
      mockContext.message!.text = '/switch coder';
      (mockDeps.sessionManager.switchAgent as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Switch error'));

      await handleSwitch(mockContext as Context, mockDeps);

      expect(replyMock).toHaveBeenCalledWith('抱歉，切換代理失敗。請稍後再試。');
    });

    it('should handle missing user', async () => {
      mockContext.from = undefined;
      mockContext.message!.text = '/switch coder';

      await handleSwitch(mockContext as Context, mockDeps);

      expect(mockDeps.sessionManager.switchAgent).not.toHaveBeenCalled();
    });
  });

  describe('handleReset', () => {
    it('should clear conversation history', async () => {
      await handleReset(mockContext as Context, mockDeps);

      expect(mockDeps.messageProcessor.clearConversation).toHaveBeenCalledWith(
        'test-session-123'
      );
      expect(replyMock.mock.calls[0][0]).toContain('對話記錄已清除');
    });

    it('should handle reset without session', async () => {
      (mockDeps.sessionManager.getOrCreateSession as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('No session'));

      await handleReset(mockContext as Context, mockDeps);

      // Should still show success message even if session not found
      expect(replyMock.mock.calls[0][0]).toContain('對話記錄已清除');
    });

    it('should handle missing user', async () => {
      mockContext.from = undefined;

      await handleReset(mockContext as Context, mockDeps);

      expect(mockDeps.messageProcessor.clearConversation).not.toHaveBeenCalled();
    });
  });
});
