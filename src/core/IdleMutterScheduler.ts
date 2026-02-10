import type { ActivityService } from './ActivityService.js';
import type { ReactionGenerator } from './ReactionGenerator.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'IdleMutterScheduler' });

export interface IdleMutterSchedulerOptions {
  activityService: ActivityService;
  reactionGenerator: ReactionGenerator;
  /** Check interval in ms (default: 30000) */
  checkIntervalMs?: number;
  /** Idle threshold in ms before eligible for mutter (default: 60000) */
  idleThresholdMs?: number;
  /** Probability of muttering when idle (0-1, default: 0.5) */
  mutterChance?: number;
}

/**
 * Periodically checks for idle agents and triggers personality-driven mutters.
 * Scheduling logic only — AI generation is delegated to ReactionGenerator.
 */
export class IdleMutterScheduler {
  private readonly activityService: ActivityService;
  private readonly reactionGenerator: ReactionGenerator;
  private readonly checkIntervalMs: number;
  private readonly idleThresholdMs: number;
  private readonly mutterChance: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: IdleMutterSchedulerOptions) {
    this.activityService = options.activityService;
    this.reactionGenerator = options.reactionGenerator;
    this.checkIntervalMs = options.checkIntervalMs ?? 30_000;
    this.idleThresholdMs = options.idleThresholdMs ?? 60_000;
    this.mutterChance = options.mutterChance ?? 0.5;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.checkIdleAgents().catch(err => {
        log.warn({ err }, 'IdleMutterScheduler check failed');
      });
    }, this.checkIntervalMs);
    log.info(
      { checkIntervalMs: this.checkIntervalMs, idleThresholdMs: this.idleThresholdMs, mutterChance: this.mutterChance },
      'IdleMutterScheduler started',
    );
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async checkIdleAgents(): Promise<void> {
    const agents = this.activityService.getTrackedAgents();

    for (const agentId of agents) {
      const idleMs = this.activityService.getIdleDuration(agentId);
      log.debug({ agentId, idleMs, threshold: this.idleThresholdMs }, 'Checking agent idle');

      if (idleMs < this.idleThresholdMs) continue;

      // Random chance
      const roll = Math.random();
      if (roll > this.mutterChance) {
        log.debug({ agentId, roll, chance: this.mutterChance }, 'Mutter skipped by probability');
        continue;
      }

      // Generate and emit mutter
      try {
        log.info({ agentId, idleMs }, 'Generating idle mutter');
        const { message, mood } = await this.reactionGenerator.generateMutter(agentId);
        this.activityService.emitMutter(agentId, message, mood);
        log.info({ agentId, message, mood }, 'Idle mutter emitted');
      } catch (err) {
        log.warn({ err, agentId }, 'Failed to generate idle mutter');
      }
    }
  }
}
