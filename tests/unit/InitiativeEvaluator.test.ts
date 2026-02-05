import { describe, it, expect, vi } from 'vitest';
import type { query } from '@anthropic-ai/claude-agent-sdk';
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

/**
 * Create a mock queryFn that returns an async generator yielding a SDK result message.
 */
function createMockQueryFn(resultText: string) {
  const mockFn = vi.fn().mockImplementation(() => {
    async function* generator() {
      yield {
        type: 'result' as const,
        subtype: 'success' as const,
        result: resultText,
        duration_ms: 100,
        duration_api_ms: 80,
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0.001,
        usage: { inputTokens: 50, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        modelUsage: {},
        permission_denials: [],
        uuid: 'test-uuid',
        session_id: 'test-session',
      };
    }
    return generator();
  });
  return mockFn as unknown as typeof query;
}

function createErrorQueryFn() {
  const mockFn = vi.fn().mockImplementation(() => {
    async function* generator() {
      throw new Error('SDK connection failed');
      // eslint-disable-next-line no-unreachable
      yield undefined as never;
    }
    return generator();
  });
  return mockFn as unknown as typeof query;
}

describe('LLMInitiativeEvaluator', () => {
  it('should return respond=true for relevant message', async () => {
    const response = JSON.stringify({ respond: true, reason: 'server issue matches engineer role' });
    const mockQueryFn = createMockQueryFn(response);
    const evaluator = new LLMInitiativeEvaluator({ queryFn: mockQueryFn, model: 'test-model' });

    const result = await evaluator.shouldRespond(
      createMessage('伺服器好像掛了'),
      '負責伺服器維運和系統監控的工程師',
      'engineer_bot',
    );

    expect(result.respond).toBe(true);
    expect(result.reason).toBe('server issue matches engineer role');
    expect(mockQueryFn).toHaveBeenCalledOnce();
    const callArgs = (mockQueryFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.options.model).toBe('test-model');
    expect(callArgs.options.maxTurns).toBe(1);
    expect(callArgs.options.tools).toEqual([]);
  });

  it('should return respond=false for irrelevant message', async () => {
    const response = JSON.stringify({ respond: false, reason: 'off-topic' });
    const mockQueryFn = createMockQueryFn(response);
    const evaluator = new LLMInitiativeEvaluator({ queryFn: mockQueryFn });

    const result = await evaluator.shouldRespond(
      createMessage('晚餐吃什麼'),
      '負責伺服器維運的工程師',
      'engineer_bot',
    );

    expect(result.respond).toBe(false);
    expect(result.reason).toBe('off-topic');
  });

  it('should return respond=false on API error (fail-safe)', async () => {
    const mockQueryFn = createErrorQueryFn();
    const evaluator = new LLMInitiativeEvaluator({ queryFn: mockQueryFn });

    const result = await evaluator.shouldRespond(
      createMessage('伺服器掛了'),
      '工程師',
      'engineer_bot',
    );

    expect(result.respond).toBe(false);
    expect(result.reason).toBe('evaluation_error');
  });

  it('should return respond=false on malformed JSON (fail-safe)', async () => {
    const mockQueryFn = createMockQueryFn('this is not json');
    const evaluator = new LLMInitiativeEvaluator({ queryFn: mockQueryFn });

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
