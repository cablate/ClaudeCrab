/**
 * Schedule Notifier
 *
 * Sends notifications about schedule execution results.
 * Sends Discord notifications for schedule execution.
 */

import type { ScheduleSpec } from './schemas.js';
import type { QueryResult } from '../core/query/SDKQueryManager.js';
import type { BaseAdapter } from '../adapters/BaseAdapter.js';

import { logger } from '../utils/logger.js';
import { playSound } from '../utils/localSound.js';

export class ScheduleNotifier {
  // Map key is agentId. Discord is the only supported notification platform.
  constructor(private adapters: Map<string, BaseAdapter>) {}

  /**
   * Resolve notification targets from spec.
   * Supports both new `targets[]` format and legacy `platform` + `chatId` format.
   */
  private resolveTargets(spec: ScheduleSpec): Array<{ platform: 'discord'; chatId: string }> {
    const notification = spec.notification;
    if (!notification) return [];

    // New format: explicit targets array
    if (notification.targets && notification.targets.length > 0) {
      return notification.targets.filter((target) => target.platform === 'discord');
    }

    // Legacy format: single platform + chatId
    if (notification.chatId) {
      return [{ platform: 'discord', chatId: notification.chatId }];
    }

    return [];
  }

  /**
   * Send notification about successful completion
   */
  async notifyComplete(spec: ScheduleSpec, result: QueryResult): Promise<void> {
    const agentId = spec.execution.agent;
    const targets = this.resolveTargets(spec);

    if (targets.length === 0) {
      logger.warn(`[ScheduleNotifier] No notification targets for schedule: ${spec.id}`);
      return;
    }

    const message = this.formatCompleteMessage(spec, result);

    for (const target of targets) {
      const adapter = this.adapters.get(agentId);
      if (!adapter) {
        logger.warn(`[ScheduleNotifier] Adapter not found for ${agentId}:${target.platform}`);
        continue;
      }

      try {
        await adapter.sendFormattedMessage(target.chatId, message);
        logger.debug(`[ScheduleNotifier] Sent completion to ${target.platform} for: ${spec.id}`);
      } catch (error) {
        logger.error({ error, scheduleId: spec.id, platform: target.platform },
          '[ScheduleNotifier] Failed to send notification');
      }
    }

    // Play local sound if configured (non-blocking)
    if (spec.notification?.localSound?.onComplete) {
      playSound(spec.notification.localSound.onComplete).catch(() => {});
    }
  }

  /**
   * Send notification about execution error
   */
  async notifyError(spec: ScheduleSpec, error: unknown): Promise<void> {
    const agentId = spec.execution.agent;
    const targets = this.resolveTargets(spec);

    if (targets.length === 0) {
      logger.warn(`[ScheduleNotifier] No notification targets for schedule: ${spec.id}`);
      return;
    }

    const message = this.formatErrorMessage(spec, error);

    for (const target of targets) {
      const adapter = this.adapters.get(agentId);
      if (!adapter) {
        logger.warn(`[ScheduleNotifier] Adapter not found for ${agentId}:${target.platform}`);
        continue;
      }

      try {
        await adapter.sendFormattedMessage(target.chatId, message);
        logger.debug(`[ScheduleNotifier] Sent error notification to ${target.platform} for: ${spec.id}`);
      } catch (notifyError) {
        logger.error({ error: notifyError, scheduleId: spec.id, platform: target.platform },
          '[ScheduleNotifier] Failed to send error notification');
      }
    }

    // Play local sound if configured (non-blocking)
    if (spec.notification?.localSound?.onError) {
      playSound(spec.notification.localSound.onError).catch(() => {});
    }
  }

  /**
   * Notify that a schedule has been auto-paused due to consecutive failures
   */
  async notifyAutoPaused(spec: ScheduleSpec, failureCount: number): Promise<void> {
    const agentId = spec.execution.agent;
    const targets = this.resolveTargets(spec);

    if (targets.length === 0) {
      logger.warn(`[ScheduleNotifier] No notification targets for schedule: ${spec.id}`);
      return;
    }

    const message = [
      `⚠️ 排程已自動暫停：${spec.name}`,
      '',
      `連續失敗 ${failureCount} 次，已自動暫停。`,
      `請檢查排程設定後使用 /schedule resume ${spec.id} 恢復。`,
    ].join('\n');

    for (const target of targets) {
      const adapter = this.adapters.get(agentId);
      if (!adapter) {
        logger.warn(`[ScheduleNotifier] Adapter not found for ${agentId}:${target.platform}`);
        continue;
      }

      try {
        await adapter.sendFormattedMessage(target.chatId, message);
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
  ): Promise<void> {
    const adapter = this.adapters.get(agentId);
    if (!adapter) {
      logger.warn(`[ScheduleNotifier] Adapter not found for ${agentId}:${platform}`);
      return;
    }

    try {
      await adapter.sendFormattedMessage(threadId, text);
    } catch (error) {
      logger.error({ error, agentId, platform, threadId },
        '[ScheduleNotifier] Failed to send to thread');
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
   * Format completion message
   */
  private formatCompleteMessage(spec: ScheduleSpec, result: QueryResult): string {
    const lines: string[] = [
      `✅ 排程任務完成：${spec.name}`,
      '',
    ];

    if (result.response) {
      lines.push(result.response);
    } else {
      lines.push('任務已成功執行。');
    }

    return lines.join('\n');
  }

  /**
   * Format error message
   */
  private formatErrorMessage(spec: ScheduleSpec, error: unknown): string {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return [
      `❌ 排程任務失敗：${spec.name}`,
      '',
      `錯誤：${errorMessage}`,
      '',
      `任務 ID：${spec.id}`,
    ].join('\n');
  }

  /**
   * Add a Discord adapter.
   */
  addAdapter(agentId: string, adapter: BaseAdapter): void {
    this.adapters.set(agentId, adapter);
  }

  /**
   * Remove adapters for an agent
   */
  removeAdapter(agentId: string, _platform?: 'discord'): void {
    this.adapters.delete(agentId);
  }
}
