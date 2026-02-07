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

  it('should delegate to multiple @mentioned bots with parallel execution (ADR-030)', async () => {
    const payload: BotRepliedPayload = {
      chatId: 'chat-1',
      agentId: 'bot-a',
      response: '[@bot_a]: @bot_b handle code, @bot_c handle design',
      platform: 'telegram',
      replyMessageId: '200',
    };

    mockProcessMessage
      .mockResolvedValueOnce({ success: true, response: 'code done' })
      .mockResolvedValueOnce({ success: true, response: 'design done' })
      .mockResolvedValueOnce({ success: true, response: 'synthesized' });

    await handler.processDelegation(payload);

    // 2 parallel delegations + 1 synthesis = 3 calls
    expect(mockProcessMessage).toHaveBeenCalledTimes(3);
    expect(mockProcessMessage).toHaveBeenCalledWith(expect.anything(), 'bot-b', expect.any(Object));
    expect(mockProcessMessage).toHaveBeenCalledWith(expect.anything(), 'bot-c', expect.any(Object));

    // Third call is synthesis to coordinator (bot-a)
    const synthesisCall = mockProcessMessage.mock.calls[2];
    expect(synthesisCall[1]).toBe('bot-a');
    expect(synthesisCall[2]).toEqual(expect.objectContaining({ isSynthesis: true }));
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

  // === ADR-030: Parallel Delegation + Synthesis ===

  it('should inject synthesis message to coordinator after parallel delegations (ADR-030)', async () => {
    const payload: BotRepliedPayload = {
      chatId: 'chat-1',
      agentId: 'bot-a',
      response: '[@bot_a]: @bot_b do X @bot_c do Y',
      platform: 'telegram',
    };

    mockProcessMessage
      .mockResolvedValueOnce({ success: true, response: 'X done' })
      .mockResolvedValueOnce({ success: true, response: 'Y done' })
      .mockResolvedValueOnce({ success: true, response: 'synthesized' });

    await handler.processDelegation(payload);

    // Third call should be synthesis to coordinator (bot-a)
    const synthesisCall = mockProcessMessage.mock.calls[2];
    expect(synthesisCall[1]).toBe('bot-a');
    expect(synthesisCall[0].metadata.isSynthesis).toBe(true);
    expect(synthesisCall[0].text).toContain('綜合整理');
    expect(synthesisCall[2].isSynthesis).toBe(true);
  });

  it('should skip delegation for synthesis responses (ADR-030)', async () => {
    const payload: BotRepliedPayload = {
      chatId: 'chat-1',
      agentId: 'bot-a',
      response: '[@bot_a]: @bot_b synthesis result mentioning bot_b',
      platform: 'telegram',
      isSynthesis: true,
    };

    await handler.processDelegation(payload);

    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it('should still synthesize when some delegations fail (ADR-030)', async () => {
    const payload: BotRepliedPayload = {
      chatId: 'chat-1',
      agentId: 'bot-a',
      response: '[@bot_a]: @bot_b do X @bot_c do Y',
      platform: 'telegram',
    };

    mockProcessMessage
      .mockResolvedValueOnce({ success: true, response: 'X done' })
      .mockRejectedValueOnce(new Error('bot-c failed'))
      .mockResolvedValueOnce({ success: true, response: 'synthesized' });

    await handler.processDelegation(payload);

    // Still 3 calls: 2 delegations + 1 synthesis
    expect(mockProcessMessage).toHaveBeenCalledTimes(3);

    // Synthesis prompt should mention failure
    const synthesisCall = mockProcessMessage.mock.calls[2];
    expect(synthesisCall[0].text).toContain('未能完成');
  });

  it('should skip synthesis when all delegations fail (ADR-030)', async () => {
    const payload: BotRepliedPayload = {
      chatId: 'chat-1',
      agentId: 'bot-a',
      response: '[@bot_a]: @bot_b do X @bot_c do Y',
      platform: 'telegram',
    };

    mockProcessMessage
      .mockRejectedValueOnce(new Error('bot-b failed'))
      .mockRejectedValueOnce(new Error('bot-c failed'));

    await handler.processDelegation(payload);

    // Only 2 delegation calls, no synthesis
    expect(mockProcessMessage).toHaveBeenCalledTimes(2);
  });

  it('should not synthesize for single target (ADR-030)', async () => {
    const payload: BotRepliedPayload = {
      chatId: 'chat-1',
      agentId: 'bot-a',
      response: '[@bot_a]: @bot_b just one',
      platform: 'telegram',
    };

    mockProcessMessage.mockResolvedValueOnce({ success: true, response: 'result' });

    await handler.processDelegation(payload);

    // Only 1 delegation call, no synthesis
    expect(mockProcessMessage).toHaveBeenCalledTimes(1);
    expect(mockProcessMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.stringContaining('bot-b') }),
      'bot-b',
      expect.objectContaining({ isGroupChat: true })
    );
  });

  // === ADR-030 Tier 1.1: Delegation responses do not trigger further delegations ===

  it('should skip delegation scan for delegation responses at depth > 0 (Tier 1.1)', async () => {
    const payload: BotRepliedPayload = {
      chatId: 'chat-1',
      agentId: 'bot-b',
      response: '[@bot_b]: 感謝 @bot_a 的指派，以下是結果 @bot_c 也可以參考',
      platform: 'telegram',
      delegationDepth: 1,
      delegationChain: ['bot-a', 'bot-b'],
    };

    await handler.processDelegation(payload);

    // Should NOT trigger any delegation despite @bot_a and @bot_c mentions
    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it('should still allow delegation at depth 0 (Tier 1.1)', async () => {
    const payload: BotRepliedPayload = {
      chatId: 'chat-1',
      agentId: 'bot-a',
      response: '[@bot_a]: 請 @bot_b 幫忙分析',
      platform: 'telegram',
      // No delegationDepth → defaults to 0
    };

    mockProcessMessage.mockResolvedValueOnce({ success: true, response: '結果' });

    await handler.processDelegation(payload);

    expect(mockProcessMessage).toHaveBeenCalledTimes(1);
  });
});
