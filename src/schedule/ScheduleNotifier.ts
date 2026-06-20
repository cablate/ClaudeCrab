/**
 * Schedule Notifier
 *
 * Sends Discord and local sound notifications for schedule execution.
 */

import type { ScheduleSpec } from './schemas.js';
import type { QueryResult } from '../core/query/types.js';
import type { BaseAdapter } from '../adapters/BaseAdapter.js';

import { formatScheduleResponse, resolveScheduleTargets } from './ScheduleOutput.js';
import { logger } from '../utils/logger.js';
import { playSound } from '../utils/localSound.js';

export class ScheduleNotifier {
  // Map key is agentId. Discord is the only supported notification platform.
  constructor(private adapters: Map<string, BaseAdapter>) {}

  /**
   * Send notification about successful completion.
   */
  async notifyComplete(spec: ScheduleSpec, result: QueryResult): Promise<void> {
    const targets = resolveScheduleTargets(spec);

    if (targets.length === 0) {
      logger.warn(`[ScheduleNotifier] No notification targets for schedule: ${spec.id}`);
      return;
    }

    const message = this.formatCompleteMessage(spec, result);

    for (const target of targets) {
      const adapter = this.adapters.get(spec.execution.agent);
      if (!adapter) {
        logger.warn(`[ScheduleNotifier] Adapter not found for ${spec.execution.agent}:${target.platform}`);
        continue;
      }

      try {
        await adapter.sendMessage(target.chatId, message);
        logger.debug(`[ScheduleNotifier] Sent completion to ${target.platform} for: ${spec.id}`);
      } catch (error) {
        logger.error({ error, scheduleId: spec.id, platform: target.platform },
          '[ScheduleNotifier] Failed to send notification');
      }
    }

    if (spec.notification?.localSound?.onComplete) {
      playSound(spec.notification.localSound.onComplete).catch(() => {});
    }
  }

  /**
   * Send notification about execution error.
   */
  async notifyError(spec: ScheduleSpec, error: unknown): Promise<void> {
    const targets = resolveScheduleTargets(spec);

    if (targets.length === 0) {
      logger.warn(`[ScheduleNotifier] No notification targets for schedule: ${spec.id}`);
      return;
    }

    const message = this.formatErrorMessage(spec, error);

    for (const target of targets) {
      const adapter = this.adapters.get(spec.execution.agent);
      if (!adapter) {
        logger.warn(`[ScheduleNotifier] Adapter not found for ${spec.execution.agent}:${target.platform}`);
        continue;
      }

      try {
        await adapter.sendMessage(target.chatId, message);
        logger.debug(`[ScheduleNotifier] Sent error notification to ${target.platform} for: ${spec.id}`);
      } catch (notifyError) {
        logger.error({ error: notifyError, scheduleId: spec.id, platform: target.platform },
          '[ScheduleNotifier] Failed to send error notification');
      }
    }

    if (spec.notification?.localSound?.onError) {
      playSound(spec.notification.localSound.onError).catch(() => {});
    }
  }

  /**
   * Notify that a schedule has been auto-paused due to consecutive failures.
   */
  async notifyAutoPaused(spec: ScheduleSpec, failureCount: number): Promise<void> {
    const targets = resolveScheduleTargets(spec);

    if (targets.length === 0) {
      logger.warn(`[ScheduleNotifier] No notification targets for schedule: ${spec.id}`);
      return;
    }

    const message = [
      `Schedule auto-paused: ${spec.name}`,
      '',
      `The schedule failed ${failureCount} consecutive times.`,
      `Use /schedule resume ${spec.id} after checking the configuration or runtime logs.`,
    ].join('\n');

    for (const target of targets) {
      const adapter = this.adapters.get(spec.execution.agent);
      if (!adapter) {
        logger.warn(`[ScheduleNotifier] Adapter not found for ${spec.execution.agent}:${target.platform}`);
        continue;
      }

      try {
        await adapter.sendMessage(target.chatId, message);
        logger.info(`[ScheduleNotifier] Sent auto-pause notification to ${target.platform} for: ${spec.id}`);
      } catch (notifyError) {
        logger.error({ error: notifyError, scheduleId: spec.id, platform: target.platform },
          '[ScheduleNotifier] Failed to send auto-pause notification');
      }
    }
  }

  /**
   * Send a message to a Discord thread created for schedule output.
   */
  async sendToThread(
    agentId: string,
    platform: 'discord',
    _chatId: string,
    threadId: string,
    text: string
  ): Promise<boolean> {
    const adapter = this.adapters.get(agentId);
    if (!adapter) {
      logger.warn(`[ScheduleNotifier] Adapter not found for ${agentId}:${platform}`);
      return false;
    }

    try {
      await adapter.sendMessage(threadId, text);
      return true;
    } catch (error) {
      logger.error({ error, agentId, platform, threadId },
        '[ScheduleNotifier] Failed to send to thread');
      return false;
    }
  }

  /**
   * Create a thread for schedule output.
   * Returns the thread ID if successful.
   */
  async createThread(
    agentId: string,
    platform: 'discord',
    chatId: string,
    threadName: string,
    initialContent?: string
  ): Promise<string | null> {
    const adapter = this.adapters.get(agentId);
    if (!adapter) {
      logger.warn(`[ScheduleNotifier] Adapter not found for ${agentId}:${platform}`);
      return null;
    }

    const result = await adapter.createThread(chatId, threadName, initialContent);
    if (result.success && result.threadId) {
      return result.threadId;
    }

    logger.warn({ error: result.error, agentId, platform },
      '[ScheduleNotifier] Failed to create thread');
    return null;
  }

  /**
   * Get adapter for an agent. The platform argument is retained for caller clarity.
   */
  getAdapter(agentId: string, platform: 'discord'): BaseAdapter | undefined {
    return platform === 'discord' ? this.adapters.get(agentId) : undefined;
  }

  /**
   * Add a Discord adapter.
   */
  addAdapter(agentId: string, adapter: BaseAdapter): void {
    this.adapters.set(agentId, adapter);
  }

  /**
   * Remove adapters for an agent.
   */
  removeAdapter(agentId: string, _platform?: 'discord'): void {
    this.adapters.delete(agentId);
  }

  private formatCompleteMessage(spec: ScheduleSpec, result: QueryResult): string {
    return [
      `Schedule completed: ${spec.name}`,
      '',
      formatScheduleResponse(result.response),
    ].join('\n');
  }

  private formatErrorMessage(spec: ScheduleSpec, error: unknown): string {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return [
      `Schedule failed: ${spec.name}`,
      '',
      `Error: ${errorMessage}`,
      '',
      `Schedule ID: ${spec.id}`,
    ].join('\n');
  }
}
