/**
 * Schedule Notifier
 *
 * Sends notifications about schedule execution results.
 */

import type { ScheduleSpec } from './schemas.js';
import type { QueryResult } from '../core/SDKQueryManager.js';
import type { BaseAdapter } from '../adapters/BaseAdapter.js';

import { logger } from '../utils/logger.js';
import { playSound } from '../utils/localSound.js';

export class ScheduleNotifier {
  // Map key is `${agentId}:${platform}` to support agents with multiple adapters
  constructor(private adapters: Map<string, BaseAdapter>) {}

  /**
   * Send notification about successful completion
   */
  async notifyComplete(spec: ScheduleSpec, result: QueryResult): Promise<void> {
    const agentId = spec.execution.agent;
    const platform = spec.notification?.platform ?? 'telegram';
    const adapter = this.adapters.get(`${agentId}:${platform}`) ?? this.adapters.get(agentId);

    if (!adapter) {
      logger.warn(`[ScheduleNotifier] Adapter not found for agent: ${agentId}`);
      return;
    }

    const chatId = spec.notification?.chatId;
    if (!chatId) {
      logger.warn(`[ScheduleNotifier] No chatId configured for schedule: ${spec.id}`);
      return;
    }

    const message = this.formatCompleteMessage(spec, result);

    try {
      await adapter.sendFormattedMessage(chatId, message);
      logger.debug(`[ScheduleNotifier] Sent completion notification for: ${spec.id}`);
    } catch (error) {
      logger.error({ error, scheduleId: spec.id }, '[ScheduleNotifier] Failed to send notification');
    }

    // Play local sound if configured (non-blocking)
    if (spec.notification?.localSound?.onComplete) {
      playSound(spec.notification.localSound.onComplete).catch(() => {
        // Already logged in playSound
      });
    }
  }

  /**
   * Send notification about execution error
   */
  async notifyError(spec: ScheduleSpec, error: unknown): Promise<void> {
    const agentId = spec.execution.agent;
    const platform = spec.notification?.platform ?? 'telegram';
    const adapter = this.adapters.get(`${agentId}:${platform}`) ?? this.adapters.get(agentId);

    if (!adapter) {
      logger.warn(`[ScheduleNotifier] Adapter not found for agent: ${agentId}`);
      return;
    }

    const chatId = spec.notification?.chatId;
    if (!chatId) {
      logger.warn(`[ScheduleNotifier] No chatId configured for schedule: ${spec.id}`);
      return;
    }

    const message = this.formatErrorMessage(spec, error);

    try {
      await adapter.sendFormattedMessage(chatId, message);
      logger.debug(`[ScheduleNotifier] Sent error notification for: ${spec.id}`);
    } catch (notifyError) {
      logger.error(
        { error: notifyError, scheduleId: spec.id },
        '[ScheduleNotifier] Failed to send error notification'
      );
    }

    // Play local sound if configured (non-blocking)
    if (spec.notification?.localSound?.onError) {
      playSound(spec.notification.localSound.onError).catch(() => {
        // Already logged in playSound
      });
    }
  }

  /**
   * Notify that a schedule has been auto-paused due to consecutive failures
   */
  async notifyAutoPaused(spec: ScheduleSpec, failureCount: number): Promise<void> {
    const agentId = spec.execution.agent;
    const platform = spec.notification?.platform ?? 'telegram';
    const adapter = this.adapters.get(`${agentId}:${platform}`) ?? this.adapters.get(agentId);

    if (!adapter) {
      logger.warn(`[ScheduleNotifier] Adapter not found for agent: ${agentId}`);
      return;
    }

    const chatId = spec.notification?.chatId;
    if (!chatId) {
      logger.warn(`[ScheduleNotifier] No chatId configured for schedule: ${spec.id}`);
      return;
    }

    const message = [
      `⚠️ 排程已自動暫停：${spec.name}`,
      '',
      `連續失敗 ${failureCount} 次，已自動暫停。`,
      `請檢查排程設定後使用 /schedule resume ${spec.id} 恢復。`,
    ].join('\n');

    try {
      await adapter.sendFormattedMessage(chatId, message);
      logger.info(`[ScheduleNotifier] Sent auto-pause notification for: ${spec.id}`);
    } catch (notifyError) {
      logger.error(
        { error: notifyError, scheduleId: spec.id },
        '[ScheduleNotifier] Failed to send auto-pause notification'
      );
    }
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
   * Add an adapter (keyed by agentId)
   */
  /**
   * Add an adapter. Key format: `${agentId}:${platform}` for platform-specific lookup.
   * Also stores under bare agentId as fallback for backward compatibility.
   */
  addAdapter(agentId: string, adapter: BaseAdapter): void {
    this.adapters.set(`${agentId}:${adapter.platform}`, adapter);
    this.adapters.set(agentId, adapter); // fallback (last-wins for agents with both platforms)
  }

  /**
   * Remove adapters for an agent (both platform-specific and fallback keys)
   */
  removeAdapter(agentId: string, platform?: string): void {
    if (platform) {
      this.adapters.delete(`${agentId}:${platform}`);
    }
    this.adapters.delete(agentId);
  }


}
