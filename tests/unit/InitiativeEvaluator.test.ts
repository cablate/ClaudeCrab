import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { LLMInitiativeEvaluator, AlwaysRespondEvaluator } from '../../src/core/InitiativeEvaluator.js';
import type { UnifiedMessage } from '../../src/adapters/types.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: { child: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}));

function createMessage(text: string): UnifiedMessage {
  return {
    id: 'test-msg-1',
    platform: 'telegram',
    userId: 'user-1',
    chatId: 'chat-1',
    text,
    timestamp: new Date(),
  };
}

describe('LLMInitiativeEvaluator', () => {
  function createEvaluator(mockResponse: unknown) {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(mockResponse) }],
    });
    const mockClient = { messages: { create: mockCreate } } as unknown as Anthropic;
    const evaluator = new LLMInitiativeEvaluator({ client: mockClient, model: 'test-model' });
    return { evaluator, mockCreate };
  }

  it('should return respond=true for relevant message', async () => {
    const { evaluator, mockCreate } = createEvaluator({ respond: true, reason: 'server issue matches engineer role' });

    const result = await evaluator.shouldRespond(
      createMessage('伺服器好像掛了'),
      '負責伺服器維運和系統監控的工程師',
      'engineer_bot',
    );

    expect(result.respond).toBe(true);
    expect(result.reason).toBe('server issue matches engineer role');
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ model: 'test-model', max_tokens: 150 });
  });

  it('should return respond=false for irrelevant message', async () => {
    const { evaluator } = createEvaluator({ respond: false, reason: 'off-topic' });

    const result = await evaluator.shouldRespond(
      createMessage('晚餐吃什麼'),
      '負責伺服器維運的工程師',
      'engineer_bot',
    );

    expect(result.respond).toBe(false);
    expect(result.reason).toBe('off-topic');
  });

  it('should return respond=false on API error (fail-safe)', async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error('API timeout'));
    const mockClient = { messages: { create: mockCreate } } as unknown as Anthropic;
    const evaluator = new LLMInitiativeEvaluator({ client: mockClient });

    const result = await evaluator.shouldRespond(
      createMessage('伺服器掛了'),
      '工程師',
      'engineer_bot',
    );

    expect(result.respond).toBe(false);
    expect(result.reason).toBe('evaluation_error');
  });

  it('should return respond=false on malformed JSON (fail-safe)', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'this is not json' }],
    });
    const mockClient = { messages: { create: mockCreate } } as unknown as Anthropic;
    const evaluator = new LLMInitiativeEvaluator({ client: mockClient });

    const result = await evaluator.shouldRespond(
      createMessage('test'),
      '工程師',
      'engineer_bot',
    );

    expect(result.respond).toBe(false);
    expect(result.reason).toBe('evaluation_error');
  });
});

describe('AlwaysRespondEvaluator', () => {
  it('should always return respond=true', async () => {
    const evaluator = new AlwaysRespondEvaluator();
    const result = await evaluator.shouldRespond(
      createMessage('anything'),
      'any description',
      'any_bot',
    );
    expect(result.respond).toBe(true);
    expect(result.reason).toBe('always_respond_evaluator');
  });
});
