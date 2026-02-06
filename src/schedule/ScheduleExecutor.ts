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
import type { AgentLoader } from '../core/AgentLoader.js';
import type { SDKQueryManager, QueryResult } from '../core/SDKQueryManager.js';
import { buildPromptContext } from '../core/constants.js';
import { PathValidator } from '../core/PathValidator.js';
import { logger } from '../utils/logger.js';

export class ScheduleExecutor {
  constructor(
    private agentLoader: AgentLoader,
    private sdkManager: SDKQueryManager,
    private notifier: ScheduleNotifier,
    private repository?: ScheduleRepository
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
        // Generate a unique session ID for this execution
        const scheduleSessionId = `schedule:${spec.id}:${executionId}`;

        // Track only the last assistant message for notification
        let lastMessage = '';

        // Execute query with new session (no resume ID)
        const result = await this.sdkManager.executeQuery(
          scheduleSessionId,
          spec.execution.prompt,
          agent,
          {
            cwd: agent.path,
            systemPrompt: agent.systemPrompt,
            settingSources: ['project'],
            // No resume = new session
            // Only pass maxTurns if defined
            ...(spec.execution.maxTurns !== undefined
              ? { maxTurns: spec.execution.maxTurns }
              : {}),
            additionalOptions: {
              abortController,
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
                PreToolUse: [
                  {
                    hooks: [
                      async (input) => {
                        const pathValidator = new PathValidator({
                          agentId,
                          workspacePath: agent.path,
                          sharedPath: path.resolve(agent.path, '../_shared'),
                        });

                        const toolInput =
                          (input as { tool_input?: Record<string, unknown> })
                            .tool_input ?? {};
                        const toolName =
                          (input as { tool_name?: string }).tool_name ?? '';

                        const result = pathValidator.validate(toolName, toolInput);

                        if (!result.allowed) {
                          const reason = result.reason ?? 'Path access denied';
                          logger.warn(
                            { agentId, toolName, reason, scheduleId: spec.id },
                            '[ScheduleExecutor] Path access denied by PathValidator'
                          );
                          return {
                            hookSpecificOutput: {
                              hookEventName: 'PreToolUse' as const,
                              permissionDecision: 'deny' as const,
                              permissionDecisionReason: reason,
                            },
                          };
                        }

                        return {
                          hookSpecificOutput: {
                            hookEventName: 'PreToolUse' as const,
                          },
                        };
                      },
                    ],
                  },
                ],
              },
            },
            // Only keep the last assistant message for notification
            onIntermediateMessage: async (text: string) => {
              lastMessage = text;
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
    if (response) {
      // Truncate long responses
      const maxLength = 500;
      if (response.length > maxLength) {
        return response.substring(0, maxLength) + '...';
      }
      return response;
    }
    return 'Execution completed';
  }
}
