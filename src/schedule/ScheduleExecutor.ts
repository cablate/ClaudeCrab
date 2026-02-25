/**
 * Schedule Executor
 *
 * Executes scheduled tasks using isolated SDK sessions.
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ScheduleSpec } from './schemas.js';
import type { ExecutionResult } from './types.js';
import type { ScheduleNotifier } from './ScheduleNotifier.js';
import type { ScheduleRepository } from '../persistence/ScheduleRepository.js';
import type { IQueryMetricsRepository } from '../persistence/types.js';
import type { AgentLoader } from '../core/AgentLoader.js';
import type { SDKQueryManager, QueryResult } from '../core/SDKQueryManager.js';
import { buildPromptContext } from '../core/constants.js';
import { retryAsync, shouldRetryError } from '../utils/retry.js';
import type { RetryOptions } from '../utils/retry.js';
import { logger } from '../utils/logger.js';

/** Schedule-specific retry options: more conservative than chat */
const SCHEDULE_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 5000,    // 5s (schedules are not time-sensitive)
  maxDelayMs: 60000,       // 60s cap
  backoffMultiplier: 3,    // 5s → 15s → 45s
  jitterFactor: 0.2,
  isRetryable: shouldRetryError,
};

export class ScheduleExecutor {
  constructor(
    private agentLoader: AgentLoader,
    private sdkManager: SDKQueryManager,
    private notifier: ScheduleNotifier,
    private repository?: ScheduleRepository,
    private queryMetricsRepository?: IQueryMetricsRepository
  ) {}

  /**
   * Execute a scheduled task
   */
  async execute(agentId: string, spec: ScheduleSpec): Promise<ExecutionResult> {
    const executionId = randomUUID();
    const startTime = Date.now();

    logger.info(
      { scheduleId: spec.id, executionId, agentId, scheduleName: spec.name },
      '[ScheduleExecutor] Starting execution'
    );

    // Record start in database
    if (this.repository) {
      await this.repository.recordStart(spec.id, executionId);
    }

    try {
      // Load agent
      const agent = await this.agentLoader.loadAgent(agentId);

      // Create abort signal with timeout
      const abortController = new AbortController();
      let timeoutId: NodeJS.Timeout | undefined;

      if (spec.execution.timeout) {
        timeoutId = setTimeout(() => {
          abortController.abort(new Error('Schedule execution timeout'));
        }, spec.execution.timeout);
      }

      try {
        // Track only the last assistant message for notification
        let lastMessage = '';

        // Execute query with retry (fresh session ID per attempt)
        const result = await retryAsync(
          async () => {
            const retrySessionId = `schedule:${spec.id}:${randomUUID()}`;
            return await this.sdkManager.executeQuery(
              retrySessionId,
              spec.execution.prompt,
              agent,
              {
                cwd: agent.path,
                systemPrompt: agent.systemPrompt,
                settingSources: ['project'],
                ...(spec.execution.maxTurns !== undefined
                  ? { maxTurns: spec.execution.maxTurns }
                  : {}),
                additionalOptions: {
                  abortController,
                  // Pass model override if specified in schedule config
                  ...(spec.execution.model ? { model: spec.execution.model } : {}),
                  hooks: {
                    UserPromptSubmit: [
                      {
                        hooks: [
                          async () => ({
                            continue: true,
                            hookSpecificOutput: {
                              hookEventName: 'UserPromptSubmit' as const,
                              additionalContext: buildPromptContext(
                                spec.notification?.chatId ?? '',
                                true // always new session
                              ),
                            },
                          }),
                        ],
                      },
                    ],
                  },
                },
                onIntermediateMessage: async (text: string) => {
                  lastMessage = text;
                },
              }
            );
          },
          {
            ...SCHEDULE_RETRY_OPTIONS,
            onRetry: (attempt: number, err: unknown, delayMs: number) => {
              // Reset timeout on retry
              if (timeoutId) {
                clearTimeout(timeoutId);
              }
              if (spec.execution.timeout) {
                timeoutId = setTimeout(() => {
                  abortController.abort(new Error('Schedule execution timeout'));
                }, spec.execution.timeout);
              }
              logger.warn({
                scheduleId: spec.id, executionId, attempt, delayMs,
                error: err instanceof Error ? err.message : String(err),
              }, '[ScheduleExecutor] Retrying after transient error');
            },
          }
        );

        // Clear timeout
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // Calculate duration
        const duration = Date.now() - startTime;

        // Use lastMessage for notification (falls back to result.response if no intermediate messages)
        const finalResponse = lastMessage || result.response;

        // Record success
        if (this.repository) {
          await this.repository.recordComplete(spec.id, executionId, {
            success: true,
            duration,
            resultSummary: this.summarizeResult(finalResponse),
          });
        }

        // Record query metrics
        if (this.queryMetricsRepository && result.usage) {
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
          });
        }

        // Send success notification with only the last message
        if (spec.notification?.onComplete) {
          const notificationResult: QueryResult = {
            ...result,
            response: finalResponse,
          };
          await this.notifier.notifyComplete(spec, notificationResult);
        }

        logger.info(
          { scheduleId: spec.id, executionId, duration, success: true },
          '[ScheduleExecutor] Execution completed'
        );

        return { success: true, duration, result };
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Record failure
      if (this.repository) {
        await this.repository.recordComplete(spec.id, executionId, {
          success: false,
          duration,
          error: errorMessage,
        });
      }

      // Send error notification
      if (spec.notification?.onError) {
        await this.notifier.notifyError(spec, error);
      }

      logger.error(
        { scheduleId: spec.id, executionId, duration, error: errorMessage },
        '[ScheduleExecutor] Execution failed'
      );

      return { success: false, duration, error };
    }
  }

  /**
   * Summarize a response for storage
   */
  private summarizeResult(response: string): string {
    return response || 'Execution completed';
  }
}
