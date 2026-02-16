import type { ActivityService } from './ActivityService.js';
import type { ReactionGenerator } from './ReactionGenerator.js';
import type { AgentLoader } from './AgentLoader.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'IdleMutterScheduler' });

export interface IdleMutterSchedulerOptions {
  activityService: ActivityService;
  reactionGenerator: ReactionGenerator;
  agentLoader: AgentLoader;
  /** Check interval in ms (default: 300_000 = 5 min) */
  checkIntervalMs?: number;
  /** Idle threshold in ms before eligible for mutter (default: 120_000 = 2 min) */
  idleThresholdMs?: number;
  /** Probability of muttering when idle (0-1, default: 0.3) */
  mutterChance?: number;
  /** Max mutters per agent per hour (default: 3) */
  maxPerAgentPerHour?: number;
  /** Callback: return true if someone is viewing Live page (SSE clients > 0) */
  hasActiveViewers?: () => boolean;
}

/**
 * Periodically checks for idle agents and triggers personality-driven mutters.
 * Cost-optimized: only runs when someone is watching, with hourly caps.
 */
export class IdleMutterScheduler {
  private readonly activityService: ActivityService;
  private readonly reactionGenerator: ReactionGenerator;
  private readonly agentLoader: AgentLoader;
  private readonly checkIntervalMs: number;
  private readonly idleThresholdMs: number;
  private readonly mutterChance: number;
  private readonly maxPerAgentPerHour: number;
  private readonly hasActiveViewers: () => boolean;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Track mutter timestamps per agent for hourly cap */
  private readonly mutterHistory = new Map<string, number[]>();

  constructor(options: IdleMutterSchedulerOptions) {
    this.activityService = options.activityService;
    this.reactionGenerator = options.reactionGenerator;
    this.agentLoader = options.agentLoader;
    this.checkIntervalMs = options.checkIntervalMs ?? 300_000;    // 5 min
    this.idleThresholdMs = options.idleThresholdMs ?? 120_000;    // 2 min
    this.mutterChance = options.mutterChance ?? 0.3;
    this.maxPerAgentPerHour = options.maxPerAgentPerHour ?? 3;
    this.hasActiveViewers = options.hasActiveViewers ?? (() => true);
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.checkIdleAgents().catch(err => {
        log.warn({ err }, 'IdleMutterScheduler check failed');
      });
    }, this.checkIntervalMs);
    log.info(
      {
        checkIntervalMs: this.checkIntervalMs,
        idleThresholdMs: this.idleThresholdMs,
        mutterChance: this.mutterChance,
        maxPerAgentPerHour: this.maxPerAgentPerHour,
      },
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
    // Skip if nobody is watching
    if (!this.hasActiveViewers()) {
      log.debug('No active viewers, skipping mutter check');
      return;
    }

    const agents = this.activityService.getTrackedAgents();
    const now = Date.now();

    for (const agentId of agents) {
      // Per-agent config override
      const agent = this.agentLoader.get(agentId);
      const mutterConfig = agent?.config.settings?.idleMutter;
      if (mutterConfig?.enabled === false) continue;

      const chance = mutterConfig?.chance ?? this.mutterChance;
      const maxPerHour = mutterConfig?.maxPerHour ?? this.maxPerAgentPerHour;

      const idleMs = this.activityService.getIdleDuration(agentId);

      if (idleMs < this.idleThresholdMs) continue;

      // Hourly cap check (per-agent override)
      if (this.isHourlyCapped(agentId, now, maxPerHour)) {
        log.debug({ agentId }, 'Mutter skipped: hourly cap reached');
        continue;
      }

      // Random chance (per-agent override)
      const roll = Math.random();
      if (roll > chance) {
        log.debug({ agentId, roll, chance }, 'Mutter skipped by probability');
        continue;
      }

      // Generate and emit mutter
      try {
        log.info({ agentId, idleMs }, 'Generating idle mutter');
        // Fetch recent mutters for this agent to avoid repetition
        const recentEvents = this.activityService.getRecent(10, { agentId, type: 'mutter' });
        const recentMessages = recentEvents.map(e => e.message).filter(Boolean);
        const { message, mood } = await this.reactionGenerator.generateMutter(agentId, recentMessages);
        this.activityService.emitMutter(agentId, message, mood);
        this.recordMutter(agentId, now);
        log.info({ agentId, message, mood }, 'Idle mutter emitted');
      } catch (err) {
        log.warn({ err, agentId }, 'Failed to generate idle mutter');
      }
    }
  }

  /** Check if agent has reached the hourly mutter cap */
  private isHourlyCapped(agentId: string, now: number, maxPerHour?: number): boolean {
    const history = this.mutterHistory.get(agentId);
    if (!history) return false;
    const oneHourAgo = now - 3_600_000;
    const recentCount = history.filter(ts => ts > oneHourAgo).length;
    return recentCount >= (maxPerHour ?? this.maxPerAgentPerHour);
  }

  /** Record a mutter timestamp and prune old entries */
  private recordMutter(agentId: string, now: number): void {
    let history = this.mutterHistory.get(agentId);
    if (!history) {
      history = [];
      this.mutterHistory.set(agentId, history);
    }
    history.push(now);
    // Prune entries older than 1 hour
    const oneHourAgo = now - 3_600_000;
    const pruned = history.filter(ts => ts > oneHourAgo);
    this.mutterHistory.set(agentId, pruned);
  }
}
