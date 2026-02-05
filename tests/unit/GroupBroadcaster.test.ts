import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GroupBroadcaster } from '../../src/core/GroupBroadcaster.js';
import { resetEventBus, getEventBus } from '../../src/core/EventBus.js';
import type { GroupMessagePayload, BotRepliedPayload } from '../../src/types/events.js';
import type { UnifiedMessage } from '../../src/adapters/types.js';
import type { MessageProcessor } from '../../src/core/MessageProcessor.js';
import type { IGroupMessageRepository } from '../../src/persistence/GroupMessageRepository.js';
import type { IGroupMemberRepository } from '../../src/persistence/GroupMemberRepository.js';

describe('GroupBroadcaster', () => {
  // Mock dependencies
  const mockProcessMessage = vi.fn().mockResolvedValue({ success: true });
  const mockMessageProcessor = {
    processMessage: mockProcessMessage,
  } as unknown as MessageProcessor;

  const mockRecordMessage = vi.fn();
  const mockGroupMessageRepository: IGroupMessageRepository = {
    recordMessage: mockRecordMessage,
    getLatestId: vi.fn().mockReturnValue(1),
    getMessagesSince: vi.fn().mockReturnValue([]),
  };

  const mockRegisterMember = vi.fn();
  const mockGetAllMembers = vi.fn().mockReturnValue([]);
  const mockGroupMemberRepository: IGroupMemberRepository = {
    registerMember: mockRegisterMember,
    getAllMembers: mockGetAllMembers,
  };

  // Bot info mapping
  const botInfoMap: Record<string, { username: string; id: number }> = {
    'bot-a': { username: 'bot_a', id: 1 },
    'bot-b': { username: 'bot_b', id: 2 },
    'bot-c': { username: 'bot_c', id: 3 },
  };

  const getBotInfo = (agentId: string) => botInfoMap[agentId] ?? null;

  // Delegation settings
  let delegationSettings: Record<string, { inbound?: boolean; outbound?: boolean }> = {};
  const getDelegationSettings = (agentId: string) => delegationSettings[agentId];

  let broadcaster: GroupBroadcaster;

  beforeEach(() => {
    vi.clearAllMocks();
    resetEventBus();
    delegationSettings = {};

    broadcaster = new GroupBroadcaster({
      messageProcessor: mockMessageProcessor,
      getBotInfo,
      groupMessageRepository: mockGroupMessageRepository,
      groupMemberRepository: mockGroupMemberRepository,
      getDelegationSettings,
    });
  });

  afterEach(() => {
    broadcaster.dispose();
  });

  // ============================================================
  // Membership Tests
  // ============================================================
  describe('Membership', () => {
    it('should register bot in group', () => {
      broadcaster.registerBotInGroup('chat-1', 'bot-a', 'telegram');

      const members = broadcaster.getGroupMembers('chat-1');
      expect(members).toContain('bot-a');
    });

    it('should not duplicate registration', () => {
      broadcaster.registerBotInGroup('chat-1', 'bot-a', 'telegram');
      broadcaster.registerBotInGroup('chat-1', 'bot-a', 'telegram');

      const members = broadcaster.getGroupMembers('chat-1');
      expect(members).toEqual(['bot-a']);
    });

    it('should persist membership to repository', () => {
      broadcaster.registerBotInGroup('chat-1', 'bot-a', 'telegram');

      expect(mockRegisterMember).toHaveBeenCalledWith('telegram', 'chat-1', 'bot-a');
    });

    it('should restore memberships from repository', () => {
      mockGetAllMembers.mockReturnValue([
        { platform: 'telegram', chat_id: 'chat-1', agent_id: 'bot-a' },
        { platform: 'telegram', chat_id: 'chat-1', agent_id: 'bot-b' },
        { platform: 'telegram', chat_id: 'chat-2', agent_id: 'bot-c' },
      ]);

      broadcaster.restoreMemberships();

      expect(broadcaster.getGroupMembers('chat-1')).toContain('bot-a');
      expect(broadcaster.getGroupMembers('chat-1')).toContain('bot-b');
      expect(broadcaster.getGroupMembers('chat-2')).toContain('bot-c');
    });
  });

  // ============================================================
  // Dedup Tests
  // ============================================================
  describe('Dedup', () => {
    it('should process message only once when emitted multiple times', async () => {
      // Pre-register bots
      broadcaster.registerBotInGroup('chat-1', 'bot-a');
      broadcaster.registerBotInGroup('chat-1', 'bot-b');

      const message: UnifiedMessage = {
        id: 'msg-1',
        platform: 'telegram',
        userId: 'user-1',
        chatId: 'chat-1',
        text: '@bot_a hello',
        timestamp: new Date(),
        metadata: { originalMessageId: '100' },
      };

      const payload: GroupMessagePayload = {
        message,
        sourceAgentId: 'bot-a',
        mentionedBot: 'bot_a',
        isReplyToBot: false,
      };

      // Emit same message twice (simulating two adapters)
      await getEventBus().emit('group:message', payload);
      await getEventBus().emit('group:message', { ...payload, sourceAgentId: 'bot-b' });

      // Should only process once
      expect(mockProcessMessage).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // Routing Tests
  // ============================================================
  describe('Routing', () => {
    beforeEach(() => {
      broadcaster.registerBotInGroup('chat-1', 'bot-a');
      broadcaster.registerBotInGroup('chat-1', 'bot-b');
    });

    it('should route to @mentioned bot', async () => {
      const message: UnifiedMessage = {
        id: 'msg-1',
        platform: 'telegram',
        userId: 'user-1',
        chatId: 'chat-1',
        text: '@bot_b help me',
        timestamp: new Date(),
        metadata: { originalMessageId: '100' },
      };

      const payload: GroupMessagePayload = {
        message,
        sourceAgentId: 'bot-a',
        mentionedBot: 'bot_b',
        isReplyToBot: false,
      };

      await getEventBus().emit('group:message', payload);

      expect(mockProcessMessage).toHaveBeenCalledTimes(1);
      expect(mockProcessMessage).toHaveBeenCalledWith(
        expect.objectContaining({ chatId: 'chat-1' }),
        'bot-b',
        expect.any(Object)
      );
    });

    it('should route to reply-to bot', async () => {
      const message: UnifiedMessage = {
        id: 'msg-1',
        platform: 'telegram',
        userId: 'user-1',
        chatId: 'chat-1',
        text: 'thanks!',
        timestamp: new Date(),
        metadata: { originalMessageId: '100' },
      };

      const payload: GroupMessagePayload = {
        message,
        sourceAgentId: 'bot-a',
        mentionedBot: null,
        isReplyToBot: true,
      };

      await getEventBus().emit('group:message', payload);

      expect(mockProcessMessage).toHaveBeenCalledTimes(1);
      expect(mockProcessMessage).toHaveBeenCalledWith(
        expect.objectContaining({ chatId: 'chat-1' }),
        'bot-a', // sourceAgentId is the reply target
        expect.any(Object)
      );
    });

    it('should not process when no mention and not reply-to', async () => {
      const message: UnifiedMessage = {
        id: 'msg-1',
        platform: 'telegram',
        userId: 'user-1',
        chatId: 'chat-1',
        text: 'hello everyone',
        timestamp: new Date(),
        metadata: { originalMessageId: '100' },
      };

      const payload: GroupMessagePayload = {
        message,
        sourceAgentId: 'bot-a',
        mentionedBot: null,
        isReplyToBot: false,
      };

      await getEventBus().emit('group:message', payload);

      expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it('should not process when mentioned bot is not in group', async () => {
      const message: UnifiedMessage = {
        id: 'msg-1',
        platform: 'telegram',
        userId: 'user-1',
        chatId: 'chat-1',
        text: '@unknown_bot help',
        timestamp: new Date(),
        metadata: { originalMessageId: '100' },
      };

      const payload: GroupMessagePayload = {
        message,
        sourceAgentId: 'bot-a',
        mentionedBot: 'unknown_bot',
        isReplyToBot: false,
      };

      await getEventBus().emit('group:message', payload);

      expect(mockProcessMessage).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Delegation Tests
  // ============================================================
  describe('Delegation', () => {
    beforeEach(() => {
      broadcaster.registerBotInGroup('chat-1', 'bot-a');
      broadcaster.registerBotInGroup('chat-1', 'bot-b');
      broadcaster.registerBotInGroup('chat-1', 'bot-c');
    });

    it('should trigger delegation when bot reply mentions another bot', async () => {
      const payload: BotRepliedPayload = {
        chatId: 'chat-1',
        agentId: 'bot-a',
        response: '[@bot_a]: Let me ask @bot_b for help',
        platform: 'telegram',
        replyMessageId: '200',
      };

      await getEventBus().emit('bot:replied', payload);

      // bot-b should be triggered via delegation
      expect(mockProcessMessage).toHaveBeenCalledTimes(1);
      expect(mockProcessMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('@bot_b'),
          metadata: expect.objectContaining({ isDelegation: true }),
        }),
        'bot-b',
        expect.objectContaining({ delegationDepth: 1 })
      );
    });

    it('should trigger multiple delegations (ADR-022)', async () => {
      const payload: BotRepliedPayload = {
        chatId: 'chat-1',
        agentId: 'bot-a',
        response: '[@bot_a]: @bot_b handle code, @bot_c handle design',
        platform: 'telegram',
        replyMessageId: '200',
      };

      await getEventBus().emit('bot:replied', payload);

      expect(mockProcessMessage).toHaveBeenCalledTimes(2);
      expect(mockProcessMessage).toHaveBeenCalledWith(
        expect.anything(),
        'bot-b',
        expect.any(Object)
      );
      expect(mockProcessMessage).toHaveBeenCalledWith(
        expect.anything(),
        'bot-c',
        expect.any(Object)
      );
    });

    it('should prevent delegation cycle (A → B → A)', async () => {
      // bot-a replied, triggering bot-b
      const payload1: BotRepliedPayload = {
        chatId: 'chat-1',
        agentId: 'bot-a',
        response: '[@bot_a]: @bot_b help',
        platform: 'telegram',
        replyMessageId: '200',
        delegationDepth: 0,
        delegationChain: ['bot-a'],
      };

      await getEventBus().emit('bot:replied', payload1);
      expect(mockProcessMessage).toHaveBeenCalledTimes(1);

      mockProcessMessage.mockClear();

      // bot-b replied, trying to delegate back to bot-a (should be blocked)
      const payload2: BotRepliedPayload = {
        chatId: 'chat-1',
        agentId: 'bot-b',
        response: '[@bot_b]: @bot_a can you help?',
        platform: 'telegram',
        replyMessageId: '201',
        delegationDepth: 1,
        delegationChain: ['bot-a', 'bot-b'],
      };

      await getEventBus().emit('bot:replied', payload2);

      // bot-a should NOT be triggered (cycle prevention)
      expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it('should stop delegation at max depth', async () => {
      // Depth 3 is max, so depth 3 reply should not trigger further delegation
      const payload: BotRepliedPayload = {
        chatId: 'chat-1',
        agentId: 'bot-a',
        response: '[@bot_a]: @bot_b help',
        platform: 'telegram',
        replyMessageId: '200',
        delegationDepth: 3,
        delegationChain: ['bot-x', 'bot-y', 'bot-z', 'bot-a'],
      };

      await getEventBus().emit('bot:replied', payload);

      expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it('should respect inbound=false setting (ADR-022)', async () => {
      delegationSettings['bot-b'] = { inbound: false };

      const payload: BotRepliedPayload = {
        chatId: 'chat-1',
        agentId: 'bot-a',
        response: '[@bot_a]: @bot_b help',
        platform: 'telegram',
        replyMessageId: '200',
      };

      await getEventBus().emit('bot:replied', payload);

      // bot-b should NOT be triggered because inbound=false
      expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it('should respect outbound=false setting (ADR-022)', async () => {
      delegationSettings['bot-a'] = { outbound: false };

      const payload: BotRepliedPayload = {
        chatId: 'chat-1',
        agentId: 'bot-a',
        response: '[@bot_a]: @bot_b help',
        platform: 'telegram',
        replyMessageId: '200',
      };

      await getEventBus().emit('bot:replied', payload);

      // bot-b should NOT be triggered because sender has outbound=false
      expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it('should not delegate to self', async () => {
      const payload: BotRepliedPayload = {
        chatId: 'chat-1',
        agentId: 'bot-a',
        response: '[@bot_a]: @bot_a I mentioned myself',
        platform: 'telegram',
        replyMessageId: '200',
      };

      await getEventBus().emit('bot:replied', payload);

      expect(mockProcessMessage).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Recording Tests
  // ============================================================
  describe('Message Recording', () => {
    it('should record user message to repository', async () => {
      broadcaster.registerBotInGroup('chat-1', 'bot-a');

      const message: UnifiedMessage = {
        id: 'msg-1',
        platform: 'telegram',
        userId: 'user-1',
        chatId: 'chat-1',
        text: '@bot_a hello',
        timestamp: new Date(),
        metadata: { originalMessageId: '100', displayName: 'John', username: 'john_doe' },
      };

      const payload: GroupMessagePayload = {
        message,
        sourceAgentId: 'bot-a',
        mentionedBot: 'bot_a',
        isReplyToBot: false,
      };

      await getEventBus().emit('group:message', payload);

      expect(mockRecordMessage).toHaveBeenCalledWith(
        'telegram',
        'chat-1',
        '100',
        'user',
        'user-1',
        expect.any(String), // sender label
        '@bot_a hello'
      );
    });

    it('should record bot reply to repository', async () => {
      const payload: BotRepliedPayload = {
        chatId: 'chat-1',
        agentId: 'bot-a',
        response: '[@bot_a]: Hello!',
        platform: 'telegram',
        replyMessageId: '200',
      };

      await getEventBus().emit('bot:replied', payload);

      expect(mockRecordMessage).toHaveBeenCalledWith(
        'telegram',
        'chat-1',
        '200',
        'bot',
        'bot-a',
        '[@bot_a]',
        '[@bot_a]: Hello!'
      );
    });
  });

  // ============================================================
  // Dispose Tests
  // ============================================================
  describe('Dispose', () => {
    it('should clear all internal state on dispose', () => {
      broadcaster.registerBotInGroup('chat-1', 'bot-a');
      broadcaster.registerBotInGroup('chat-1', 'bot-b');

      broadcaster.dispose();

      expect(broadcaster.getGroupMembers('chat-1')).toEqual([]);
    });
  });
});
