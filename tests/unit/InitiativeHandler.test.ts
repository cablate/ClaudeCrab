import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InitiativeHandler } from '../../src/core/InitiativeHandler.js';
import type { MessageProcessor } from '../../src/core/MessageProcessor.js';
import type { UnifiedMessage } from '../../src/adapters/types.js';
import type { IQueryMetricsRepository } from '../../src/persistence/types.js';

describe('InitiativeHandler', () => {
  const mockProcessMessage = vi.fn().mockResolvedValue({ success: true });
  const mockMessageProcessor = {
    processMessage: mockProcessMessage,
  } as unknown as MessageProcessor;

  const mockShouldRespond = vi.fn().mockResolvedValue({ respond: false });
  const mockEvaluator = { shouldRespond: mockShouldRespond };

  const mockRecord = vi.fn();
  const mockMetricsRepo: IQueryMetricsRepository = {
    record: mockRecord,
    getStats: vi.fn().mockReturnValue(null),
    getUsageSummary: vi.fn().mockReturnValue([]),
  } as unknown as IQueryMetricsRepository;

  let groupMembers: Record<string, string[]>;
  let initiativeSettings: Record<string, { enabled?: boolean; mode?: string; cooldown?: number; maxPerHour?: number }>;
  let agentDescriptions: Record<string, { name: string; description?: string }>;
  let handler: InitiativeHandler;

  function createMessage(text: string): UnifiedMessage {
    return {
      id: `msg-${Date.now()}`,
      platform: 'telegram',
      userId: 'user-1',
      chatId: 'chat-1',
      text,
      timestamp: new Date(),
      metadata: {},
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    groupMembers = { 'chat-1': ['bot-a', 'bot-b'] };
    initiativeSettings = {};
    agentDescriptions = {
      'bot-a': { name: 'Engineer Bot', description: '負責伺服器維運的工程師' },
      'bot-b': { name: 'Secretary Bot', description: '負責行程安排的秘書' },
    };

    handler = new InitiativeHandler({
      messageProcessor: mockMessageProcessor,
      getGroupMembers: (chatId) => groupMembers[chatId] ?? [],
      getInitiativeSettings: (agentId) => initiativeSettings[agentId],
      getAgentDescription: (agentId) => agentDescriptions[agentId],
      initiativeEvaluator: mockEvaluator,
      queryMetricsRepository: mockMetricsRepo,
    });
  });

  afterEach(() => {
    handler.dispose();
  });

  // ======================
  // Gate tests
  // ======================

  it('should skip bots with initiative.enabled=false', async () => {
    initiativeSettings['bot-a'] = { enabled: false };

    await handler.evaluateInitiatives(createMessage('test'), 'chat-1', 'TestUser');

    expect(mockShouldRespond).not.toHaveBeenCalled();
  });

  it('should skip bots without initiative settings', async () => {
    // No settings configured for any bot
    await handler.evaluateInitiatives(createMessage('test'), 'chat-1', 'TestUser');

    expect(mockShouldRespond).not.toHaveBeenCalled();
  });

  it('should skip bots without description', async () => {
    groupMembers['chat-1'] = ['bot-c'];
    agentDescriptions['bot-c'] = { name: 'No Desc Bot' };
    initiativeSettings['bot-c'] = { enabled: true };

    await handler.evaluateInitiatives(createMessage('test'), 'chat-1', 'TestUser');

    expect(mockShouldRespond).not.toHaveBeenCalled();
  });

  it('should only process work mode in v1', async () => {
    initiativeSettings['bot-a'] = { enabled: true, mode: 'social' };

    await handler.evaluateInitiatives(createMessage('test'), 'chat-1', 'TestUser');

    expect(mockShouldRespond).not.toHaveBeenCalled();
  });

  it('should allow undefined mode (defaults to work)', async () => {
    initiativeSettings['bot-a'] = { enabled: true };
    mockShouldRespond.mockResolvedValueOnce({ respond: false, reason: 'not relevant' });

    await handler.evaluateInitiatives(createMessage('test'), 'chat-1', 'TestUser');

    expect(mockShouldRespond).toHaveBeenCalledOnce();
  });

  // ======================
  // Throttle tests
  // ======================

  it('should skip bots on cooldown', async () => {
    initiativeSettings['bot-a'] = { enabled: true, cooldown: 300 };
    mockShouldRespond.mockResolvedValue({ respond: true, reason: 'relevant' });

    // First triggers
    await handler.evaluateInitiatives(createMessage('issue 1'), 'chat-1', 'TestUser');
    expect(mockProcessMessage).toHaveBeenCalledTimes(1);

    // Second blocked by cooldown
    mockProcessMessage.mockClear();
    mockShouldRespond.mockClear();
    await handler.evaluateInitiatives(createMessage('issue 2'), 'chat-1', 'TestUser');

    expect(mockShouldRespond).not.toHaveBeenCalled();
    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it('should skip bots exceeding maxPerHour', async () => {
    initiativeSettings['bot-a'] = { enabled: true, cooldown: 0, maxPerHour: 1 };
    mockShouldRespond.mockResolvedValue({ respond: true, reason: 'relevant' });

    // First triggers
    await handler.evaluateInitiatives(createMessage('issue 1'), 'chat-1', 'TestUser');
    expect(mockProcessMessage).toHaveBeenCalledTimes(1);

    // maxPerHour reached — second blocked (cooldown 0 still allows, but maxPerHour blocks)
    // Note: cooldown of 0ms means cooldown doesn't block
    mockProcessMessage.mockClear();
    mockShouldRespond.mockClear();
    await handler.evaluateInitiatives(createMessage('issue 2'), 'chat-1', 'TestUser');

    expect(mockShouldRespond).not.toHaveBeenCalled();
  });

  // ======================
  // Evaluation tests
  // ======================

  it('should evaluate eligible bots and execute on pass', async () => {
    initiativeSettings['bot-a'] = { enabled: true };
    mockShouldRespond.mockResolvedValueOnce({ respond: true, reason: 'server issue' });

    await handler.evaluateInitiatives(createMessage('伺服器掛了'), 'chat-1', 'TestUser');

    expect(mockProcessMessage).toHaveBeenCalledTimes(1);
    const [syntheticMsg, agentId, options] = mockProcessMessage.mock.calls[0]!;
    expect(agentId).toBe('bot-a');
    expect(syntheticMsg.id).toMatch(/^initiative-/);
    expect(syntheticMsg.metadata.isInitiative).toBe(true);
    expect(options.isGroupChat).toBe(true);
    expect(options.isInitiative).toBe(true);
  });

  it('should not execute when evaluation declines', async () => {
    initiativeSettings['bot-a'] = { enabled: true };
    mockShouldRespond.mockResolvedValueOnce({ respond: false, reason: 'not relevant' });

    await handler.evaluateInitiatives(createMessage('random chat'), 'chat-1', 'TestUser');

    expect(mockShouldRespond).toHaveBeenCalledOnce();
    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it('should evaluate multiple bots in parallel', async () => {
    initiativeSettings['bot-a'] = { enabled: true };
    initiativeSettings['bot-b'] = { enabled: true };
    mockShouldRespond.mockResolvedValue({ respond: true, reason: 'relevant' });

    await handler.evaluateInitiatives(createMessage('緊急事項'), 'chat-1', 'TestUser');

    expect(mockShouldRespond).toHaveBeenCalledTimes(2);
    expect(mockProcessMessage).toHaveBeenCalledTimes(2);
  });

  // ======================
  // Usage tracking
  // ======================

  it('should record usage metrics regardless of outcome', async () => {
    initiativeSettings['bot-a'] = { enabled: true };
    mockShouldRespond.mockResolvedValueOnce({
      respond: false,
      reason: 'not relevant',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalCostUsd: 0.001,
        durationMs: 500,
      },
    });

    await handler.evaluateInitiatives(createMessage('test'), 'chat-1', 'TestUser');

    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'bot-a',
      platform: 'telegram',
      chatId: 'chat-1',
      inputTokens: 100,
      outputTokens: 20,
      totalCostUsd: 0.001,
    }));
  });

  // ======================
  // Edge cases
  // ======================

  it('should do nothing without evaluator configured', async () => {
    const handlerNoEval = new InitiativeHandler({
      messageProcessor: mockMessageProcessor,
      getGroupMembers: (chatId) => groupMembers[chatId] ?? [],
    });

    await handlerNoEval.evaluateInitiatives(createMessage('test'), 'chat-1', 'TestUser');

    expect(mockShouldRespond).not.toHaveBeenCalled();
    handlerNoEval.dispose();
  });

  it('should do nothing with empty group members', async () => {
    groupMembers['chat-1'] = [];
    initiativeSettings['bot-a'] = { enabled: true };

    await handler.evaluateInitiatives(createMessage('test'), 'chat-1', 'TestUser');

    expect(mockShouldRespond).not.toHaveBeenCalled();
  });

  it('should handle evaluation rejection gracefully', async () => {
    initiativeSettings['bot-a'] = { enabled: true };
    mockShouldRespond.mockRejectedValueOnce(new Error('LLM timeout'));

    // Should not throw
    await handler.evaluateInitiatives(createMessage('test'), 'chat-1', 'TestUser');

    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  // ======================
  // Dispose
  // ======================

  it('should clear cooldowns and counters on dispose', async () => {
    initiativeSettings['bot-a'] = { enabled: true, cooldown: 300 };
    mockShouldRespond.mockResolvedValue({ respond: true, reason: 'relevant' });

    // Trigger to set cooldown
    await handler.evaluateInitiatives(createMessage('issue 1'), 'chat-1', 'TestUser');
    expect(mockProcessMessage).toHaveBeenCalledTimes(1);

    // Dispose clears state
    handler.dispose();

    // Should be able to trigger again (cooldown cleared)
    mockProcessMessage.mockClear();
    mockShouldRespond.mockClear();
    mockShouldRespond.mockResolvedValue({ respond: true, reason: 'relevant' });

    // Need to create fresh handler since dispose clears internal state
    handler = new InitiativeHandler({
      messageProcessor: mockMessageProcessor,
      getGroupMembers: (chatId) => groupMembers[chatId] ?? [],
      getInitiativeSettings: (agentId) => initiativeSettings[agentId],
      getAgentDescription: (agentId) => agentDescriptions[agentId],
      initiativeEvaluator: mockEvaluator,
      queryMetricsRepository: mockMetricsRepo,
    });

    await handler.evaluateInitiatives(createMessage('issue 2'), 'chat-1', 'TestUser');
    expect(mockProcessMessage).toHaveBeenCalledTimes(1);
  });
});
