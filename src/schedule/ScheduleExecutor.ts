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
import type { SDKQueryManager, QueryResult } from '../core/query/SDKQueryManager.js';
import { buildPromptContext } from '../core/constants.js';
import { retryAsync } from '../utils/retry.js';
import type { RetryOptions } from '../utils/retry.js';
import { logger } from '../utils/logger.js';

/** Schedule-specific retry options: more conservative than chat */
const SCHEDULE_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 5,
  initialDelayMs: 5000,    // 5s (schedules are not time-sensitive)
  maxDelayMs: 60000,       // 60s cap
  backoffMultiplier: 3,    // 5s → 15s → 45s → 60s → 60s
  jitterFactor: 0.2,
  isRetryable: () => true, // Schedules retry on ANY error — they run once/day, worth retrying
};

export class ScheduleExecutor {
  private threadMap: ScheduleThreadMap | null = null;

  constructor(
    private agentLoader: AgentLoader,
    private sdkManager: SDKQueryManager,
    private notifier: ScheduleNotifier,
    private repository?: ScheduleRepository,
    private queryMetricsRepository?: IQueryMetricsRepository,
    private sessionRepository?: ISessionRepository
  ) {}

  /**
   * Late dependency injection for services that depend on Discord adapters.
   * Called by AppBootstrap after Discord initialization completes.
   *
   * Race window: between construction and wirePostInit(), these services are undefined.
   * All usage sites have null guards (optional chaining) to handle this gracefully.
   */
  wirePostInit(deps: {
    threadMap?: ScheduleThreadMap;
  }): void {
    if (deps.threadMap !== undefined) this.threadMap = deps.threadMap;
  }

  /**
   * Resolve notification targets from spec for thread creation.
   */
  private resolveTargets(spec: ScheduleSpec): Array<{ platform: 'discord'; chatId: string }> {
    const notification = spec.notification;
    if (!notification) return [];
    if (notification.targets && notification.targets.length > 0) return notification.targets;
    if (notification.chatId) {
      return [{ platform: notification.platform ?? 'discord', chatId: notification.chatId }];
    }
    return [];
  }

  /**
   * Resolve the thread title from template and spec.
   */
  private resolveThreadTitle(spec: ScheduleSpec): string {
    const template = spec.output?.threadTitle ?? '{{name}} — {{date}}';
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    return template
      .replace(/\{\{name\}\}/g, spec.name)
      .replace(/\{\{date\}\}/g, dateStr)
      .replace(/\{\{id\}\}/g, spec.id);
  }

  /**
   * Resolve the channel ID for thread creation on a specific platform.
   */
  private resolveThreadChannelId(spec: ScheduleSpec, platform: 'discord', fallbackChatId: string): string {
    const output = spec.output;
    if (!output) return fallbackChatId;

    return output.forumChannelId ?? output.channelId ?? fallbackChatId;
  }

  /**
   * Execute a scheduled task
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

    // Record start in database
    if (this.repository) {
      await this.repository.recordStart(spec.id, executionId);
    }

    // Pre-create threads if output mode is 'thread'
    const createdThreads: Array<{ platform: 'discord'; chatId: string; threadId: string }> = [];
    if (outputMode === 'thread') {
      const targets = this.resolveTargets(spec);
      const threadTitle = this.resolveThreadTitle(spec);

      for (const target of targets) {
        const channelId = this.resolveThreadChannelId(spec, target.platform, target.chatId);
        const threadId = await this.notifier.createThread(
          agentId, target.platform, channelId, threadTitle
        );
        if (threadId) {
          createdThreads.push({ platform: target.platform, chatId: target.chatId, threadId });
          logger.info({ threadId, platform: target.platform, scheduleId: spec.id },
            '[ScheduleExecutor] Created output thread');
        }
      }
    }

    try {
      // Load agent
      const agent = await this.agentLoader.loadAgent(agentId);

      // Create abort signal with timeout — fresh per execution
      const abortController = new AbortController();
      let timeoutId: NodeJS.Timeout | undefined;

      if (spec.execution.timeout) {
        timeoutId = setTimeout(() => {
          abortController.abort(new Error('Schedule execution timeout'));
        }, spec.execution.timeout);
      }

      try {
        // Track messages for different delivery modes
        let lastMessage = '';
        const allMessages: string[] = [];

        // Thread mode always uses stable sessionId for follow-up conversation continuity
        const sessionId = isThreadMode
          ? `schedule:${spec.id}:thread`
          : `schedule:${spec.id}:${randomUUID()}`;

        // Execute query with retry
        const result = await retryAsync(
          async () => {
            const retrySessionId = isThreadMode
              ? sessionId  // Stable ID for thread mode (no per-retry randomness)
              : `schedule:${spec.id}:${randomUUID()}`;

            return await this.sdkManager.executeQuery(
              retrySessionId,
              spec.execution.prompt,
              agent,
              {
                cwd: agent.path,
                systemPrompt: agent.systemPrompt,
                settingSources: ['project', 'local'],
                ...(spec.execution.maxTurns !== undefined
                  ? { maxTurns: spec.execution.maxTurns }
                  : {}),
                additionalOptions: {
                  abortController,
                  persistSession: isThreadMode,
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
                                true, // always new session
                                spec.notification?.platform ?? 'discord'
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
                  allMessages.push(text);

                  // Streaming mode: send each intermediate message to threads
                  if (deliveryMode === 'streaming' && createdThreads.length > 0) {
                    for (const thread of createdThreads) {
                      await this.notifier.sendToThread(
                        agentId, thread.platform, thread.chatId, thread.threadId, text
                      );
                    }
                  }
                },
              }
            );
          },
          {
            ...SCHEDULE_RETRY_OPTIONS,
            onRetry: (attempt: number, err: unknown, delayMs: number) => {
              // Reset timeout on retry with fresh AbortController
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
            sdkSessionId: result.sdkSessionId,
          });
        }

        // --- Output delivery ---

        if (outputMode === 'thread') {
          const targets = this.resolveTargets(spec);
          const threadedPlatforms = new Set(createdThreads.map(t => t.platform));

          // Send result to successfully created threads (unless streaming already sent everything)
          if (createdThreads.length > 0 && deliveryMode !== 'streaming') {
            const outputText = deliveryMode === 'summary'
              ? this.formatSummary(spec, allMessages, finalResponse)
              : this.formatCompleteForThread(spec, finalResponse);

            for (const thread of createdThreads) {
              await this.notifier.sendToThread(
                agentId, thread.platform, thread.chatId, thread.threadId, outputText
              );
            }
          }

          // Register thread mappings for follow-up conversations
          if (result.sdkSessionId) {
            const now = new Date();
            for (const thread of createdThreads) {
              // In-memory cache (fast lookup, lost on restart)
              this.threadMap?.set({
                threadId: thread.threadId,
                platform: thread.platform,
                agentId,
                scheduleId: spec.id,
                sdkSessionId: result.sdkSessionId,
                chatId: thread.chatId,
                createdAt: now,
                lastActiveAt: now,
              });

              // Persisted session row (survives restart, authoritative source)
              if (this.sessionRepository) {
                const threadUserId = `schedule:thread:${thread.threadId}`;
                this.sessionRepository.save({
                  session_id: randomUUID(),
                  agent_id: agentId,
                  platform: 'discord',
                  user_id: threadUserId,
                  state: 'idle',
                  created_at: now.toISOString(),
                  last_active_at: now.toISOString(),
                  sdk_session_id: result.sdkSessionId,
                  processed_message_ids: '[]',
                  is_active: 1,
                  continuation_source: 'schedule',
                  continuation_state: 'pending',
                });
                logger.info(
                  { threadId: thread.threadId, agentId, sdkSessionId: result.sdkSessionId },
                  'Pre-created session row for schedule thread continuation'
                );
              }
            }
          }

          // Fallback: platforms where thread creation failed get regular message notification
          if (spec.notification?.onComplete) {
            const failedTargets = targets.filter(t => !threadedPlatforms.has(t.platform));
            for (const target of failedTargets) {
              const adapter = this.notifier.getAdapter(agentId, target.platform);
              if (adapter) {
                const message = `✅ 排程任務完成：${spec.name}\n\n${finalResponse || '任務已成功執行。'}`;
                await adapter.sendFormattedMessage(target.chatId, message);
              }
            }
          }
        } else if (spec.notification?.onComplete) {
          // Message mode: send notification (existing behavior)
          const notificationResult: QueryResult = {
            ...result,
            response: finalResponse,
          };
          await this.notifier.notifyComplete(spec, notificationResult);
        }

        logger.info(
          { scheduleId: spec.id, executionId, duration, success: true,
            threadsCreated: createdThreads.length, outputMode, deliveryMode },
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

      // Send error notification (to threads if created, otherwise to notification targets)
      if (createdThreads.length > 0) {
        const errorText = `❌ 排程任務失敗：${spec.name}\n\n錯誤：${errorMessage}`;
        for (const thread of createdThreads) {
          await this.notifier.sendToThread(
            agentId, thread.platform, thread.chatId, thread.threadId, errorText
          );
        }
      } else if (spec.notification?.onError) {
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
   * Format a summary of all intermediate messages for 'summary' delivery mode.
   */
  private formatSummary(spec: ScheduleSpec, messages: string[], finalResponse: string): string {
    const lines: string[] = [
      `📋 排程執行摘要：${spec.name}`,
      '',
    ];

    if (messages.length > 1) {
      lines.push(`共 ${messages.length} 個執行步驟：`);
      lines.push('');
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i] ?? '';
        const preview = msg.length > 200 ? msg.slice(0, 200) + '...' : msg;
        lines.push(`**Step ${i + 1}:**`);
        lines.push(preview);
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    }

    lines.push('**最終結果：**');
    lines.push(finalResponse || '任務已成功執行。');

    return lines.join('\n');
  }

  /**
   * Format completion message for thread output.
   */
  private formatCompleteForThread(spec: ScheduleSpec, response: string): string {
    return response || '任務已成功執行。';
  }

  /**
   * Summarize a response for storage
   */
  private summarizeResult(response: string): string {
    return response || 'Execution completed';
  }
}
