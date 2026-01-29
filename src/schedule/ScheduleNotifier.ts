/**
 * Schedule Notifier
 *
 * Sends notifications about schedule execution results.
 */

import type { ScheduleSpec } from './schemas.js';
import type { QueryResult } from '../core/SDKQueryManager.js';
import type { BaseAdapter } from '../adapters/BaseAdapter.js';
import { logger } from '../utils/logger.js';

export class ScheduleNotifier {
  constructor(private adapters: Map<string, BaseAdapter>) {}

  /**
   * Send notification about successful completion
   */
  async notifyComplete(spec: ScheduleSpec, result: QueryResult): Promise<void> {
    const platform = spec.notification?.platform ?? 'telegram';
    const adapter = this.adapters.get(platform);

    if (!adapter) {
      logger.warn(`[ScheduleNotifier] Adapter not found for platform: ${platform}`);
      return;
    }

    const chatId = spec.notification?.chatId;
    if (!chatId) {
      logger.warn(`[ScheduleNotifier] No chatId configured for schedule: ${spec.id}`);
      return;
    }

    const message = this.formatCompleteMessage(spec, result);

    try {
      await adapter.sendMessage(chatId, message);
      logger.debug(`[ScheduleNotifier] Sent completion notification for: ${spec.id}`);
    } catch (error) {
      logger.error({ error, scheduleId: spec.id }, '[ScheduleNotifier] Failed to send notification');
    }
  }

  /**
   * Send notification about execution error
   */
  async notifyError(spec: ScheduleSpec, error: unknown): Promise<void> {
    const platform = spec.notification?.platform ?? 'telegram';
    const adapter = this.adapters.get(platform);

    if (!adapter) {
      logger.warn(`[ScheduleNotifier] Adapter not found for platform: ${platform}`);
      return;
    }

    const chatId = spec.notification?.chatId;
    if (!chatId) {
      logger.warn(`[ScheduleNotifier] No chatId configured for schedule: ${spec.id}`);
      return;
    }

    const message = this.formatErrorMessage(spec, error);

    try {
      await adapter.sendMessage(chatId, message);
      logger.debug(`[ScheduleNotifier] Sent error notification for: ${spec.id}`);
    } catch (notifyError) {
      logger.error(
        { error: notifyError, scheduleId: spec.id },
        '[ScheduleNotifier] Failed to send error notification'
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
      // Truncate long responses
      const maxLength = 1000;
      let response = result.response;
      if (response.length > maxLength) {
        response = response.substring(0, maxLength) + '...(truncated)';
      }
      lines.push(response);
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
   * Add an adapter
   */
  addAdapter(platform: string, adapter: BaseAdapter): void {
    this.adapters.set(platform, adapter);
  }

  /**
   * Remove an adapter
   */
  removeAdapter(platform: string): void {
    this.adapters.delete(platform);
  }
}
