import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseAdapter } from '../src/adapters/BaseAdapter.ts';
import type {
  QuestionPromptOptions,
  QuestionPromptResult,
  QuestionResolver,
} from '../src/adapters/types.ts';
import type { SendOptions, SendResult } from '../src/types/message.ts';
import {
  checkSessionGuard,
  type SessionGuardConfig,
} from '../src/core/session/SessionGuard.ts';
import type {
  SDKSessionManager,
  SessionCacheActivityState,
} from '../src/core/session/SDKSessionManager.ts';
import type { UserSession } from '../src/types/session.ts';

interface GuardState {
  guardShownForLength: boolean;
  guardLastShownTokenCount: number | undefined;
  guardShownForCacheTTL: boolean;
}

class FakeSDKSessionManager {
  state: GuardState | null = {
    guardShownForLength: false,
    guardLastShownTokenCount: undefined,
    guardShownForCacheTTL: false,
  };
  activity: SessionCacheActivityState | null = {
    lastActivityAt: Date.now(),
    source: 'lastQueryAt',
    lastCacheTouchAt: undefined,
    lastQueryAt: Date.now(),
    lastUsedAt: Date.now(),
  };
  tokenCount: number | null = null;
  detectedCacheTTLMs: number | null = null;
  updates: Array<Partial<GuardState>> = [];

  getSessionCacheActivityState(_sessionId: string): SessionCacheActivityState | null {
    return this.activity;
  }

  getSessionGuardState(_sessionId: string): GuardState | null {
    return this.state;
  }

  getSessionTokenCount(_sessionId: string): number | null {
    return this.tokenCount;
  }

  getDetectedCacheTTLMs(_sessionId: string): number | null {
    return this.detectedCacheTTLMs;
  }

  setSessionGuardState(_sessionId: string, state: Partial<GuardState>): void {
    this.updates.push(state);
    if (this.state !== null) {
      this.state = { ...this.state, ...state };
    }
  }
}

class FakeAdapter extends BaseAdapter {
  questionAnswer: string | null = '0';
  throwOnQuestion = false;
  questionPrompts: QuestionPromptOptions[] = [];
  private questionResolver: QuestionResolver | undefined;

  async sendMessage(
    _chatId: string,
    _text: string,
    _options?: SendOptions,
  ): Promise<SendResult> {
    return { success: true, messageId: 'message-id' };
  }

  async sendTypingIndicator(_chatId: string): Promise<void> {
    // No-op for guard tests.
  }

  override setQuestionResolver(resolver: QuestionResolver): void {
    this.questionResolver = resolver;
  }

  override async sendQuestionPrompt(
    _chatId: string,
    options: QuestionPromptOptions,
  ): Promise<QuestionPromptResult> {
    if (this.throwOnQuestion) {
      throw new Error('question prompt failed');
    }
    this.questionPrompts.push(options);
    this.questionResolver?.(options.requestId, this.questionAnswer);
    return { success: true, messageId: 'question-message-id' };
  }

  protected async doInitialize(): Promise<void> {
    // No-op for guard tests.
  }

  protected async doStart(): Promise<void> {
    // No-op for guard tests.
  }

  protected async doStop(): Promise<void> {
    // No-op for guard tests.
  }

  protected async doDispose(): Promise<void> {
    // No-op for guard tests.
  }
}

const config: SessionGuardConfig = {
  enabled: true,
  tokenThreshold: 100,
  cacheTTLMs: 60 * 60 * 1000,
};

const session: UserSession = {
  sessionId: 'session-id',
  agentId: 'coder',
  platform: 'discord',
  userId: 'user-id',
  state: 'idle',
  createdAt: new Date(),
  lastActiveAt: new Date(),
  processedMessageIds: new Set(),
  isActive: true,
};

const tempRoots: string[] = [];

async function createEmptyProfileRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'claudecab-session-guard-'));
  tempRoots.push(root);
  return root;
}

function asSdkManager(fake: FakeSDKSessionManager): SDKSessionManager {
  return fake as unknown as SDKSessionManager;
}

describe('checkSessionGuard', () => {
  beforeEach(async () => {
    const profileRoot = await createEmptyProfileRoot();
    vi.stubEnv('USERPROFILE', profileRoot);
    vi.stubEnv('HOME', profileRoot);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('continues without prompting when there is no managed guard state', async () => {
    const sdkSessionManager = new FakeSDKSessionManager();
    sdkSessionManager.activity = null;
    sdkSessionManager.state = null;
    const adapter = new FakeAdapter({ platform: 'discord', agentId: 'coder' });

    const result = await checkSessionGuard(
      { sdkSessionManager: asSdkManager(sdkSessionManager), adapter, chatId: 'chat-id' },
      session,
      config,
    );

    expect(result).toBe('continue');
    expect(adapter.questionPrompts).toEqual([]);
  });

  it('shows the length guard once when token count first crosses the threshold', async () => {
    const sdkSessionManager = new FakeSDKSessionManager();
    sdkSessionManager.tokenCount = 120;
    const adapter = new FakeAdapter({ platform: 'discord', agentId: 'coder' });
    adapter.questionAnswer = '0';

    const result = await checkSessionGuard(
      { sdkSessionManager: asSdkManager(sdkSessionManager), adapter, chatId: 'chat-id' },
      session,
      config,
    );

    expect(result).toBe('continue');
    expect(adapter.questionPrompts).toHaveLength(1);
    expect(adapter.questionPrompts[0]?.header).toBe('Session Too Long');
    expect(sdkSessionManager.state).toMatchObject({
      guardShownForLength: true,
      guardLastShownTokenCount: 120,
    });
  });

  it('does not repeat the length guard until token count grows by more than 50 percent', async () => {
    const sdkSessionManager = new FakeSDKSessionManager();
    sdkSessionManager.tokenCount = 130;
    sdkSessionManager.state = {
      guardShownForLength: true,
      guardLastShownTokenCount: 120,
      guardShownForCacheTTL: false,
    };
    const adapter = new FakeAdapter({ platform: 'discord', agentId: 'coder' });

    const result = await checkSessionGuard(
      { sdkSessionManager: asSdkManager(sdkSessionManager), adapter, chatId: 'chat-id' },
      session,
      config,
    );

    expect(result).toBe('continue');
    expect(adapter.questionPrompts).toEqual([]);
    expect(sdkSessionManager.updates).toEqual([]);
  });

  it('repeats the length guard after token count grows by more than 50 percent', async () => {
    const sdkSessionManager = new FakeSDKSessionManager();
    sdkSessionManager.tokenCount = 181;
    sdkSessionManager.state = {
      guardShownForLength: true,
      guardLastShownTokenCount: 120,
      guardShownForCacheTTL: false,
    };
    const adapter = new FakeAdapter({ platform: 'discord', agentId: 'coder' });
    adapter.questionAnswer = '1';

    const result = await checkSessionGuard(
      { sdkSessionManager: asSdkManager(sdkSessionManager), adapter, chatId: 'chat-id' },
      session,
      config,
    );

    expect(result).toBe('switch');
    expect(adapter.questionPrompts).toHaveLength(1);
    expect(sdkSessionManager.state).toMatchObject({
      guardShownForLength: true,
      guardLastShownTokenCount: 181,
    });
  });

  it('prioritizes cache TTL guard over length guard when the session has been idle too long', async () => {
    const sdkSessionManager = new FakeSDKSessionManager();
    sdkSessionManager.tokenCount = 200;
    sdkSessionManager.activity = {
      lastActivityAt: Date.now() - 2 * 60 * 60 * 1000,
      source: 'lastQueryAt',
      lastCacheTouchAt: undefined,
      lastQueryAt: Date.now() - 2 * 60 * 60 * 1000,
      lastUsedAt: Date.now() - 2 * 60 * 60 * 1000,
    };
    const adapter = new FakeAdapter({ platform: 'discord', agentId: 'coder' });
    adapter.questionAnswer = '1';

    const result = await checkSessionGuard(
      { sdkSessionManager: asSdkManager(sdkSessionManager), adapter, chatId: 'chat-id' },
      session,
      config,
    );

    expect(result).toBe('switch');
    expect(adapter.questionPrompts).toHaveLength(1);
    expect(adapter.questionPrompts[0]?.header).toBe('Cache Expired');
    expect(sdkSessionManager.state).toMatchObject({ guardShownForCacheTTL: true });
  });

  it('returns timeout when the guard prompt cannot be sent', async () => {
    const sdkSessionManager = new FakeSDKSessionManager();
    sdkSessionManager.tokenCount = 120;
    const adapter = new FakeAdapter({ platform: 'discord', agentId: 'coder' });
    adapter.throwOnQuestion = true;

    const result = await checkSessionGuard(
      { sdkSessionManager: asSdkManager(sdkSessionManager), adapter, chatId: 'chat-id' },
      session,
      config,
    );

    expect(result).toBe('timeout');
  });
});
