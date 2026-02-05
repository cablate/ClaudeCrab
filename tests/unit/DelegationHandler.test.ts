import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DelegationHandler } from '../../src/core/DelegationHandler.js';
import type { BotRepliedPayload } from '../../src/types/events.js';
import type { MessageProcessor } from '../../src/core/MessageProcessor.js';

describe('DelegationHandler', () => {
  const mockProcessMessage = vi.fn().mockResolvedValue({ success: true });
  const mockMessageProcessor = {
    processMessage: mockProcessMessage,
  } as unknown as MessageProcessor;

  const botInfoMap: Record<string, { username: string; id: number }> = {
    'bot-a': { username: 'bot_a', id: 1 },
    'bot-b': { username: 'bot_b', id: 2 },
    'bot-c': { username: 'bot_c', id: 3 },
  };
  const getBotInfo = (agentId: string) => botInfoMap[agentId] ?? null;

  let groupMembers: Record<string, string[]>;
  let delegationSettings: Record<string, { inbound?: boolean; outbound?: boolean }>;
  let handler: DelegationHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    groupMembers = { 'chat-1': ['bot-a', 'bot-b', 'bot-c'] };
    delegationSettings = {};

    handler = new DelegationHandler({
      messageProcessor: mockMessageProcessor,
      getGroupMembers: (chatId) => groupMembers[chatId] ?? [],
      getBotInfo,
      getDelegationSettings: (agentId) => delegationSettings[agentId],
    });
  });

  it('should delegate to a single @mentioned bot', async () => {
    const payload: BotRepliedPayload = {
      chatId: 'chat-1',
      agentId: 'bot-a',
      response: '[@bot_a]: Let me ask @bot_b for help',
      platform: 'telegram',
      replyMessageId: '200',
    };

    await handler.processDelegation(payload);

    expect(mockProcessMessage).toHaveBeenCalledTimes(1);
    expect(mockProcessMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ isDelegation: true, delegationFrom: 'bot-a' }),
      }),
      'bot-b',
      expect.objectContaining({ delegationDepth: 1, delegationChain: ['bot-a', 'bot-b'] })
    );
  });

  it('should delegate to multiple @mentioned bots', async () => {
    const payload: BotRepliedPayload = {
      chatId: 'chat-1',
      agentId: 'bot-a',
      response: '[@bot_a]: @bot_b handle code, @bot_c handle design',
      platform: 'telegram',
      replyMessageId: '200',
    };

    await handler.processDelegation(payload);

    expect(mockProcessMessage).toHaveBeenCalledTimes(2);
    expect(mockProcessMessage).toHaveBeenCalledWith(expect.anything(), 'bot-b', expect.any(Object));
    expect(mockProcessMessage).toHaveBeenCalledWith(expect.anything(), 'bot-c', expect.any(Object));
  });

  it('should prevent delegation cycle (A → B → A)', async () => {
    const payload: BotRepliedPayload = {
      chatId: 'chat-1',
      agentId: 'bot-b',
      response: '[@bot_b]: @bot_a can you help?',
      platform: 'telegram',
      replyMessageId: '201',
      delegationDepth: 1,
      delegationChain: ['bot-a', 'bot-b'],
    };

    await handler.processDelegation(payload);

    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it('should stop delegation at max depth (3)', async () => {
    const payload: BotRepliedPayload = {
      chatId: 'chat-1',
      agentId: 'bot-a',
      response: '[@bot_a]: @bot_b help',
      platform: 'telegram',
      replyMessageId: '200',
      delegationDepth: 3,
      delegationChain: ['bot-x', 'bot-y', 'bot-z', 'bot-a'],
    };

    await handler.processDelegation(payload);

    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it('should respect inbound=false setting', async () => {
    delegationSettings['bot-b'] = { inbound: false };

    const payload: BotRepliedPayload = {
      chatId: 'chat-1',
      agentId: 'bot-a',
      response: '[@bot_a]: @bot_b help',
      platform: 'telegram',
      replyMessageId: '200',
    };

    await handler.processDelegation(payload);

    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it('should respect outbound=false setting', async () => {
    delegationSettings['bot-a'] = { outbound: false };

    const payload: BotRepliedPayload = {
      chatId: 'chat-1',
      agentId: 'bot-a',
      response: '[@bot_a]: @bot_b help',
      platform: 'telegram',
      replyMessageId: '200',
    };

    await handler.processDelegation(payload);

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

    await handler.processDelegation(payload);

    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it('should skip initiative responses (ADR-023)', async () => {
    const payload: BotRepliedPayload = {
      chatId: 'chat-1',
      agentId: 'bot-a',
      response: '[@bot_a]: @bot_b some reply',
      platform: 'telegram',
      isInitiative: true,
    };

    await handler.processDelegation(payload);

    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it('should not delegate to bots not in the group', async () => {
    groupMembers['chat-1'] = ['bot-a']; // only bot-a in group

    const payload: BotRepliedPayload = {
      chatId: 'chat-1',
      agentId: 'bot-a',
      response: '[@bot_a]: @bot_b help',
      platform: 'telegram',
      replyMessageId: '200',
    };

    await handler.processDelegation(payload);

    expect(mockProcessMessage).not.toHaveBeenCalled();
  });
});
