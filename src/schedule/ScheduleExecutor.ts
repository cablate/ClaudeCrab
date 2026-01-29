/**
 * Schedule Executor
 *
 * Executes scheduled tasks using isolated SDK sessions.
 */

import { randomUUID } from 'node:crypto';
import type { ScheduleSpec } from './schemas.js';
import type { ExecutionResult } from './types.js';
import type { ScheduleNotifier } from './ScheduleNotifier.js';
import type { ScheduleRepository } from '../persistence/ScheduleRepository.js';
import type { AgentLoader } from '../core/AgentLoader.js';
import type { SDKQueryManager, QueryResult } from '../core/SDKQueryManager.js';
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

        // Execute query with new session (no resume ID)
        const result = await this.sdkManager.executeQuery(
          scheduleSessionId,
          spec.execution.prompt,
          agent,
          {
            cwd: agent.path,
            systemPrompt: agent.systemPrompt,
            settingSources: ['local'],
            // No resume = new session
            // Only pass maxTurns if defined
            ...(spec.execution.maxTurns !== undefined
              ? { maxTurns: spec.execution.maxTurns }
              : {}),
            additionalOptions: {
              abortController,
            },
          }
        );

        // Clear timeout
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // Calculate duration
        const duration = Date.now() - startTime;

        // Record success
        if (this.repository) {
          await this.repository.recordComplete(spec.id, executionId, {
            success: true,
            duration,
            resultSummary: this.summarizeResult(result),
          });
        }

        // Send success notification
        if (spec.notification?.onComplete) {
          await this.notifier.notifyComplete(spec, result);
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
   * Summarize a query result for storage
   */
  private summarizeResult(result: QueryResult): string {
    if (result.response) {
      // Truncate long responses
      const maxLength = 500;
      if (result.response.length > maxLength) {
        return result.response.substring(0, maxLength) + '...';
      }
      return result.response;
    }
    return 'Execution completed';
  }
}
