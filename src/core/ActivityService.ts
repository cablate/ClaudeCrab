import type { ActivityEvent, ActivityPhase, ActivityMood } from '../types/activity.js';
import type { ActivityRepository } from '../persistence/ActivityRepository.js';
import { getEventBus } from './EventBus.js';
import { logger } from '../utils/logger.js';
import { randomUUID } from 'node:crypto';

const log = logger.child({ module: 'ActivityService' });

/** Phase descriptions for operational activity events. */
const PHASE_DESCRIPTIONS: Record<ActivityPhase, string> = {
  task_received: 'Task received',
  working: 'Working',
  tool_use: 'Using tool',
  completed: 'Completed',
  error: 'Error',
  idle: 'Idle',
};

export interface ActivityServiceOptions {
  /** Function to get agent name by ID */
  getAgentName: (agentId: string) => string;
  /** ActivityRepository for SQLite persistence */
  activityRepository?: ActivityRepository | undefined;
  /** Max events in the ring buffer */
  bufferSize?: number;
}

/**
 * Central service for agent activity events (v2.0 Characters Come Alive).
 * Holds a ring buffer of recent events, generates personality-driven reactions
 * via Haiku, and emits events to the EventBus for SSE broadcast.
 */
export class ActivityService {
  private readonly buffer: ActivityEvent[] = [];
  private readonly maxSize: number;
  private readonly eventBus = getEventBus();
  private readonly getAgentName: (agentId: string) => string;
  private readonly activityRepository: ActivityRepository | undefined;

  /** Track last activity timestamp per agent (for idle detection) */
  private readonly lastActivity = new Map<string, number>();

  /** Track current phase per agent (for frontend status display) */
  private readonly agentPhase = new Map<string, ActivityPhase>();

  /** Track current mood per agent */
  private readonly agentMood = new Map<string, ActivityMood>();
  private readonly idleResetTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Batch write queue for DB persistence */
  private writeQueue: ActivityEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private static readonly FLUSH_INTERVAL_MS = 2_000;
  private static readonly FLUSH_THRESHOLD = 20;
  private static readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1_000; // 1 hour
  private static readonly RETENTION_DAYS = 7;

  constructor(options: ActivityServiceOptions) {
    this.getAgentName = options.getAgentName;
    this.activityRepository = options.activityRepository;
    this.maxSize = options.bufferSize ?? 200;

    if (this.activityRepository) {
      this.flushTimer = setInterval(() => this.flushWriteQueue(), ActivityService.FLUSH_INTERVAL_MS);
      this.cleanupTimer = setInterval(() => this.cleanupOldEvents(), ActivityService.CLEANUP_INTERVAL_MS);
      this.cleanupOldEvents(); // run once at startup
      this.restoreMoodFromDb();
    }
  }

  /** Restore agent mood state from DB on startup */
  private restoreMoodFromDb(): void {
    if (!this.activityRepository) return;
    try {
      const rows = this.activityRepository.getLatestMoodByAgent();
      for (const { agentId, mood } of rows) {
        this.agentMood.set(agentId, mood as ActivityMood);
      }
      if (rows.length > 0) {
        log.info({ restoredAgents: rows.length }, 'Restored agent mood from DB');
      }
    } catch (err) {
      log.warn({ err }, 'Failed to restore agent mood from DB');
    }
  }

  /**
  /**
   * Emit a factual status event for a lifecycle phase.
   */
  emitReaction(agentId: string, phase: ActivityPhase, metadata?: Record<string, unknown>): void {
    this.trackActivity(agentId);
    this.agentPhase.set(agentId, phase);
    const event = this.createEvent(agentId, 'status_change', PHASE_DESCRIPTIONS[phase], phase, 'neutral', metadata);
    this.pushAndEmit(event);
  }

  /**
   * Emit a mutter (idle chatter). Message is already generated.
   */
  emitMutter(agentId: string, message: string, mood?: ActivityMood): void {
    this.agentPhase.set(agentId, 'idle');
    this.agentMood.set(agentId, mood ?? 'bored');
    const event = this.createEvent(agentId, 'mutter', message, 'idle', mood ?? 'bored');
    this.pushAndEmit(event);
  }

  /**
   * Emit a status change without personality generation.
   */
  emitStatusChange(agentId: string, phase: ActivityPhase, mood?: ActivityMood): void {
    this.trackActivity(agentId);
    this.agentPhase.set(agentId, phase);
    if (mood) this.agentMood.set(agentId, mood);
    const event = this.createEvent(agentId, 'status_change', PHASE_DESCRIPTIONS[phase], phase, mood);
    this.pushAndEmit(event);
  }

  /**
   * Emit a structured workflow event (factual, no personality generation).
   * Used for showing "what's actually happening" in the activity feed.
   */
  emitWorkflow(agentId: string, phase: ActivityPhase, message: string, metadata?: Record<string, unknown>): void {
    this.trackActivity(agentId);
    this.agentPhase.set(agentId, phase);
    const event = this.createEvent(agentId, 'workflow', message, phase, undefined, metadata);
    this.pushAndEmit(event);

    // Auto-reset to idle after terminal phases
    if (phase === 'completed' || phase === 'error') {
      // Cancel previous idle-reset timer for this agent (prevents accumulation during rapid retries)
      const prev = this.idleResetTimers.get(agentId);
      if (prev !== undefined) clearTimeout(prev);

      const timer = setTimeout(() => {
        this.idleResetTimers.delete(agentId);
        // Only reset if phase hasn't been updated by a new task
        if (this.agentPhase.get(agentId) === phase) {
          this.agentPhase.set(agentId, 'idle');
          const idleEvent = this.createEvent(agentId, 'workflow', PHASE_DESCRIPTIONS.idle, 'idle', undefined);
          this.pushAndEmit(idleEvent);
        }
      }, 5_000);
      this.idleResetTimers.set(agentId, timer);
    }
  }

  /**
   * Emit a reply event (agent's response to user message).
   * Stored truncated for Live backlog display.
   */
  emitReply(agentId: string, message: string, metadata?: Record<string, unknown>): void {
    this.trackActivity(agentId);
    const event = this.createEvent(agentId, 'reply', message, undefined, undefined, metadata);
    this.pushAndEmit(event);
  }

  /** Get recent events (for initial SSE load) */
  getRecent(limit = 50, filters?: { agentId?: string; type?: string; since?: string }): ActivityEvent[] {
    // Use repository if available (supports filters + persisted history across restarts)
    if (this.activityRepository) {
      return this.activityRepository.getRecent(limit, filters);
    }
    // Fallback to in-memory buffer
    return this.buffer.slice(-limit);
  }

  /** Get agent's current state for frontend display */
  getAgentState(agentId: string): {
    phase: ActivityPhase;
    mood: ActivityMood;
    lastActivity: number | undefined;
    lastEvent: ActivityEvent | undefined;
  } {
    const events = this.buffer.filter(e => e.agentId === agentId);
    let phase = this.agentPhase.get(agentId) ?? 'idle';

    // Auto-expire stale phases: if no activity for 60s, treat as idle
    const lastAct = this.lastActivity.get(agentId);
    const isStale = lastAct && (Date.now() - lastAct) > 60_000;
    if (phase !== 'idle' && isStale) {
      phase = 'idle';
      this.agentPhase.set(agentId, 'idle');
    }

    // Always return the latest event ??frontend decides display
    const lastEvent = events.length > 0 ? events[events.length - 1] : undefined;

    return {
      phase,
      mood: this.agentMood.get(agentId) ?? 'neutral',
      lastActivity: lastAct,
      lastEvent,
    };
  }

  /** Record activity timestamp (for idle detection) */
  trackActivity(agentId: string): void {
    this.lastActivity.set(agentId, Date.now());
  }

  /** Get idle duration in ms for an agent */
  getIdleDuration(agentId: string): number {
    const last = this.lastActivity.get(agentId);
    if (!last) return Infinity;
    return Date.now() - last;
  }

  /** Get all tracked agent IDs */
  getTrackedAgents(): string[] {
    return [...this.lastActivity.keys()];
  }

  // --- Private ---

  private createEvent(
    agentId: string,
    type: 'reaction' | 'mutter' | 'status_change' | 'workflow' | 'reply',
    message: string,
    phase?: ActivityPhase,
    mood?: ActivityMood,
    metadata?: Record<string, unknown>,
  ): ActivityEvent {
    const event: ActivityEvent = {
      id: randomUUID(),
      agentId,
      agentName: this.getAgentName(agentId),
      type,
      message,
      timestamp: new Date().toISOString(),
    };
    if (phase !== undefined) event.phase = phase;
    if (mood !== undefined) event.mood = mood;
    if (metadata !== undefined) event.metadata = metadata;
    return event;
  }

  private pushAndEmit(event: ActivityEvent): void {
    // Ring buffer
    this.buffer.push(event);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }

    // Update mood from event
    if (event.mood) {
      this.agentMood.set(event.agentId, event.mood);
    }

    // Emit to EventBus for SSE broadcast
    this.eventBus.emitSync('activity', event);

    // Queue for batch persistence
    if (this.activityRepository) {
      this.writeQueue.push(event);
      if (this.writeQueue.length >= ActivityService.FLUSH_THRESHOLD) {
        this.flushWriteQueue();
      }
    }

    log.debug(
      { agentId: event.agentId, type: event.type, phase: event.phase, message: event.message.substring(0, 50) },
      'Activity event emitted',
    );
  }

  /** Flush queued events to DB in a single transaction */
  private flushWriteQueue(): void {
    if (this.writeQueue.length === 0 || !this.activityRepository) return;
    const batch = this.writeQueue.splice(0);
    try {
      this.activityRepository.insertBatch(batch);
    } catch (err) {
      log.warn({ err, count: batch.length }, 'Failed to persist activity batch');
    }
  }

  /** Delete events older than retention period */
  private cleanupOldEvents(): void {
    if (!this.activityRepository) return;
    try {
      const cutoff = new Date(Date.now() - ActivityService.RETENTION_DAYS * 24 * 60 * 60 * 1_000).toISOString();
      const deleted = this.activityRepository.deleteOlderThan(cutoff);
      if (deleted > 0) {
        log.info({ deleted, retentionDays: ActivityService.RETENTION_DAYS }, 'Cleaned up old activity events');
      }
    } catch (err) {
      log.warn({ err }, 'Failed to cleanup old activity events');
    }
  }

  /** Clean shutdown: flush pending writes and clear timers */
  /** Get aggregated stats from DB (since a given ISO date) */
  getStats(sinceIso: string): { total: number; workflow: number; personality: number; messagesHandled: number; tasksCompleted: number; byAgent: Array<{ agentId: string; agentName: string; count: number }> } | null {
    // Flush pending writes first so stats are up-to-date
    this.flushWriteQueue();
    return this.activityRepository?.getStats(sinceIso) ?? null;
  }

  dispose(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const timer of this.idleResetTimers.values()) {
      clearTimeout(timer);
    }
    this.idleResetTimers.clear();
    this.flushWriteQueue();
    log.info('ActivityService disposed');
  }

}
