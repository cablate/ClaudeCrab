/**
 * Schedule Thread Map
 *
 * In-memory registry mapping Discord thread IDs to schedule sessions.
 * Enables users to continue conversations in schedule-created threads.
 */

import type { ScheduleThreadMapping } from './types.js';
import { logger } from '../utils/logger.js';

export class ScheduleThreadMap {
  // Key: Discord threadId -> mapping. Platform is retained on records for DB/log compatibility.
  private threads = new Map<string, ScheduleThreadMapping>();

  /**
   * Register a new thread mapping after schedule creates a thread.
   */
  set(mapping: ScheduleThreadMapping): void {
    const k = mapping.threadId;
    this.threads.set(k, mapping);
    logger.debug({ threadId: mapping.threadId, platform: mapping.platform, scheduleId: mapping.scheduleId },
      '[ScheduleThreadMap] Registered thread mapping');
  }

  /**
   * Look up a Discord thread mapping by threadId.
   * Returns undefined if no mapping exists (not a schedule thread).
   */
  get(platform: 'discord', threadId: string): ScheduleThreadMapping | undefined {
    return platform === 'discord' ? this.threads.get(threadId) : undefined;
  }

  /**
   * Update the SDK session ID for a thread (after user follow-up creates new session).
   */
  updateSessionId(platform: 'discord', threadId: string, sdkSessionId: string): void {
    const mapping = this.get(platform, threadId);
    if (mapping) {
      mapping.sdkSessionId = sdkSessionId;
      mapping.lastActiveAt = new Date();
    }
  }

  /**
   * Get total count of tracked threads.
   */
  get size(): number {
    return this.threads.size;
  }
}
