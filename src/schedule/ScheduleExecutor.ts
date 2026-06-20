/**
 * Schedule Executor
 *
 * Executes scheduled tasks using isolated SDK sessions.
 * Supports thread-based output with follow-up conversation capability.
 */

import { randomUUID } from 'node:crypto';
import type { ScheduleSpec } from './schemas.js';
import type { ExecutionResult } from './types.js';
import type { ScheduleNotifier } from './ScheduleNotifier.js';
import type { ScheduleThreadMap } from './ScheduleThreadMap.js';
import type { ScheduleRepository } from '../persistence/ScheduleRepository.js';
import type { IQueryMetricsRepository, ISessionRepository } from '../persistence/types.js';
import type { AgentLoader } from '../core/orchestrator/AgentLoader.js';
import type { SDKSessionManager } from '../core/session/SDKSessionManager.js';
import type { QueryResult } from '../core/query/types.js';
import {
  type CreatedScheduleThread,
  buildThreadMapping,
  createPersistedScheduleThreadSession,
  formatScheduleStart,
  formatScheduleResponse,
  formatScheduleSummary,
  resolveScheduleTargets,
  resolveThreadChannelId,
  resolveThreadTitle,
  summarizeScheduleResult,
} from './ScheduleOutput.js';
import { buildPromptContext } from '../core/constants.js';
import { retryAsync } from '../utils/retry.js';
import type { RetryOptions } from '../utils/retry.js';
import { logger } from '../utils/logger.js';

/** Schedule-specific retry options: more conservative than chat */
const SCHEDULE_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 5,
  initialDelayMs: 5000,
  maxDelayMs: 60000,
  backoffMultiplier: 3,
  jitterFactor: 0.2,
  isRetryable: () => true,
};

export class ScheduleExecutor {
  private threadMap: ScheduleThreadMap | null = null;

  constructor(
    private agentLoader: AgentLoader,
    private sdkSessionManager: SDKSessionManager,
    private notifier: ScheduleNotifier,
    private repository?: ScheduleRepository,
    private queryMetricsRepository?: IQueryMetricsRepository,
    private sessionRepository?: ISessionRepository
  ) {}

  /**
   * Late dependency injection for services that depend on Discord adapters.
   * Called by AppBootstrap after Discord initialization completes.
   */
  wirePostInit(deps: {
    threadMap?: ScheduleThreadMap;
  }): void {
    if (deps.threadMap !== undefined) this.threadMap = deps.threadMap;
  }

  /**
   * Execute a scheduled task.
   */
  async execute(agentId: string, spec: ScheduleSpec): Promise<ExecutionResult> {
    const executionId = randomUUID();
    const startTime = Date.now();
    const outputMode = spec.output?.mode ?? 'message';
    const deliveryMode = spec.output?.delivery ?? 'last-only';
    const isThreadMode = outputMode === 'thread';

    logger.info(
      { scheduleId: spec.id, executionId, agentId, scheduleName: spec.name, outputMode, deliveryMode },
      '[ScheduleExecutor] Starting execution'
    );

    if (this.repository) {
      await this.repository.recordStart(spec.id, executionId);
    }

    const createdThreads = await this.createOutputThreads(agentId, spec, isThreadMode);

    try {
      const agent = await this.agentLoader.loadAgent(agentId);
      let timeoutId: NodeJS.Timeout | undefined;

      const clearExecutionTimeout = (): void => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
      };

      try {
        let lastMessage = '';
        const allMessages: string[] = [];
        const sessionId = isThreadMode
          ? `schedule:${spec.id}:thread`
          : `schedule:${spec.id}:${randomUUID()}`;

        const result = await retryAsync(
          async () => {
            const abortController = new AbortController();
            const retrySessionId = isThreadMode
              ? sessionId
              : `schedule:${spec.id}:${randomUUID()}`;

            if (spec.execution.timeout) {
              timeoutId = setTimeout(() => {
                abortController.abort(new Error('Schedule execution timeout'));
              }, spec.execution.timeout);
            }

            try {
              const contextTarget = resolveScheduleTargets(spec)[0];
              return await this.sdkSessionManager.executeQuery(
                retrySessionId,
                spec.execution.prompt,
                agent,
                {
                  cwd: agent.path,
                  systemPrompt: agent.systemPrompt,
                  settingSources: ['project', 'local'],
                  abortController,
                  persistSession: isThreadMode,
                  ...(spec.execution.maxTurns !== undefined
                    ? { maxTurns: spec.execution.maxTurns }
                    : {}),
                  ...(spec.execution.model ? { model: spec.execution.model } : {}),
                  hooks: {
                    UserPromptSubmit: [
                      {
                        hooks: [
                          () => Promise.resolve({
                            continue: true,
                            hookSpecificOutput: {
                              hookEventName: 'UserPromptSubmit' as const,
                              additionalContext: buildPromptContext(
                                contextTarget?.chatId ?? '',
                                true,
                                contextTarget?.platform ?? 'discord'
                              ),
                            },
                          }),
                        ],
                      },
                    ],
                  },
                  onIntermediateMessage: async (text: string) => {
                    lastMessage = text;
                    allMessages.push(text);

                    if (deliveryMode === 'streaming' && createdThreads.length > 0) {
                      for (const thread of createdThreads) {
                        const sent = await this.notifier.sendToThread(
                          agentId, thread.platform, thread.chatId, thread.threadId, text
                        );
                        if (!sent) {
                          throw new Error(`Failed to stream schedule output to Discord thread ${thread.threadId}`);
                        }
                      }
                    }
                  },
                }
              );
            } finally {
              clearExecutionTimeout();
              // Schedule execution is a background job: keep only the sdkSessionId
              // for future thread follow-up resume, never the live CLI process.
              this.sdkSessionManager.destroySession(retrySessionId);
            }
          },
          {
            ...SCHEDULE_RETRY_OPTIONS,
            onRetry: (attempt: number, err: unknown, delayMs: number) => {
              logger.warn({
                scheduleId: spec.id, executionId, attempt, delayMs,
                error: err instanceof Error ? err.message : String(err),
              }, '[ScheduleExecutor] Retrying after transient error');
            },
          }
        );

        clearExecutionTimeout();

        const duration = Date.now() - startTime;
        const finalResponse = lastMessage || result.response;

        const sdkErrorMessage = detectScheduleSdkError(finalResponse);
        if (sdkErrorMessage) {
          throw new Error(sdkErrorMessage);
        }

        await this.deliverOutput(agentId, spec, result, finalResponse, allMessages, createdThreads);

        if (this.repository) {
          await this.repository.recordComplete(executionId, {
            success: true,
            duration,
            resultSummary: summarizeScheduleResult(finalResponse),
          });
        }

        this.recordQueryMetrics(agentId, spec, result, duration);

        logger.info(
          { scheduleId: spec.id, executionId, duration, success: true,
            threadsCreated: createdThreads.length, outputMode, deliveryMode },
          '[ScheduleExecutor] Execution completed'
        );

        return { success: true, duration, result };
      } finally {
        clearExecutionTimeout();
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (this.repository) {
        await this.repository.recordComplete(executionId, {
          success: false,
          duration,
          error: errorMessage,
        });
      }

      await this.deliverError(agentId, spec, error, errorMessage, createdThreads);

      logger.error(
        { scheduleId: spec.id, executionId, duration, error: errorMessage },
        '[ScheduleExecutor] Execution failed'
      );

      return { success: false, duration, error };
    }
  }

  private async createOutputThreads(
    agentId: string,
    spec: ScheduleSpec,
    isThreadMode: boolean
  ): Promise<CreatedScheduleThread[]> {
    if (!isThreadMode) return [];

    const createdThreads: CreatedScheduleThread[] = [];
    const threadTitle = resolveThreadTitle(spec);
    const initialContent = formatScheduleStart(spec);

    for (const target of resolveScheduleTargets(spec)) {
      const channelId = resolveThreadChannelId(spec, target.chatId);
      const threadId = await this.notifier.createThread(
        agentId, target.platform, channelId, threadTitle, initialContent
      );

      if (threadId) {
        createdThreads.push({ platform: target.platform, chatId: target.chatId, threadId });
        logger.info({ threadId, platform: target.platform, scheduleId: spec.id },
          '[ScheduleExecutor] Created output thread');
      }
    }

    if (resolveScheduleTargets(spec).length > 0 && createdThreads.length === 0) {
      throw new Error(`Failed to create any output thread for schedule ${spec.id}`);
    }

    return createdThreads;
  }

  private recordQueryMetrics(
    agentId: string,
    spec: ScheduleSpec,
    result: QueryResult,
    duration: number
  ): void {
    if (!this.queryMetricsRepository || !result.usage) return;

    this.queryMetricsRepository.record({
      agentId,
      platform: 'schedule',
      chatId: spec.id,
      userId: 'system',
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadInputTokens ?? 0,
      cacheCreationTokens: result.usage.cacheCreationInputTokens ?? 0,
      totalCostUsd: result.totalCostUsd ?? result.usage.costUsd ?? 0,
      numTurns: result.numTurns ?? 0,
      durationMs: result.durationMs ?? duration,
      sdkSessionId: result.sdkSessionId,
    });
  }

  private async deliverOutput(
    agentId: string,
    spec: ScheduleSpec,
    result: QueryResult,
    finalResponse: string,
    allMessages: string[],
    createdThreads: CreatedScheduleThread[]
  ): Promise<void> {
    const outputMode = spec.output?.mode ?? 'message';
    const deliveryMode = spec.output?.delivery ?? 'last-only';

    if (outputMode !== 'thread') {
      if (spec.notification?.onComplete) {
        await this.notifier.notifyComplete(spec, { ...result, response: finalResponse });
      }
      return;
    }

    const targets = resolveScheduleTargets(spec);
    const threadedPlatforms = new Set(createdThreads.map(t => t.platform));

    if (createdThreads.length > 0 && deliveryMode !== 'streaming') {
      const outputText = deliveryMode === 'summary'
        ? formatScheduleSummary(spec, allMessages, finalResponse)
        : formatScheduleResponse(finalResponse);

      for (const thread of createdThreads) {
        const sent = await this.notifier.sendToThread(
          agentId, thread.platform, thread.chatId, thread.threadId, outputText
        );
        if (!sent) {
          throw new Error(`Failed to deliver schedule output to Discord thread ${thread.threadId}`);
        }
      }
    }

    if (result.sdkSessionId) {
      this.registerThreadContinuations(agentId, spec, result.sdkSessionId, createdThreads);
    }

    if (spec.notification?.onComplete) {
      const failedTargets = targets.filter(t => !threadedPlatforms.has(t.platform));
      for (const target of failedTargets) {
        const adapter = this.notifier.getAdapter(agentId, target.platform);
        if (adapter) {
          const message = `Schedule completed: ${spec.name}\n\n${formatScheduleResponse(finalResponse)}`;
          await adapter.sendMessage(target.chatId, message);
        }
      }
    }
  }

  private registerThreadContinuations(
    agentId: string,
    spec: ScheduleSpec,
    sdkSessionId: string,
    createdThreads: CreatedScheduleThread[]
  ): void {
    const now = new Date();

    for (const thread of createdThreads) {
      this.threadMap?.set(buildThreadMapping({
        thread,
        agentId,
        scheduleId: spec.id,
        sdkSessionId,
        now,
      }));

      if (this.sessionRepository) {
        this.sessionRepository.save(createPersistedScheduleThreadSession({
          agentId,
          thread,
          sdkSessionId,
          now,
        }));
        logger.info(
          { threadId: thread.threadId, agentId, sdkSessionId },
          'Pre-created session row for schedule thread continuation'
        );
      }
    }
  }

  private async deliverError(
    agentId: string,
    spec: ScheduleSpec,
    error: unknown,
    errorMessage: string,
    createdThreads: CreatedScheduleThread[]
  ): Promise<void> {
    if (createdThreads.length === 0) {
      if (spec.notification?.onError) {
        await this.notifier.notifyError(spec, error);
      }
      return;
    }

    const errorText = `Schedule failed: ${spec.name}\n\nError: ${errorMessage}`;
    for (const thread of createdThreads) {
      await this.notifier.sendToThread(
        agentId, thread.platform, thread.chatId, thread.threadId, errorText
      );
    }
  }

  dispose(): void {
    this.sdkSessionManager.dispose();
  }
}

function detectScheduleSdkError(response: string): string | null {
  const text = response.trim();
  if (!text) return null;

  const knownErrorPatterns = [
    /^Authentication error\b/i,
    /^API Error\b/i,
    /^OAuth error\b/i,
    /^Rate limit error\b/i,
  ];

  if (knownErrorPatterns.some((pattern) => pattern.test(text))) {
    return text.split(/\r?\n/, 1)[0] ?? 'Schedule SDK error';
  }

  return null;
}
