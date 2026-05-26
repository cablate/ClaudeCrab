/**
 * BudgetService — per-agent budget control with auto-pause.
 *
 * Checks cumulative cost against configured daily/monthly budgets.
 * Exceeding budget → agent marked as paused → no more queries until reset.
 *
 * Borrowed from Paperclip's cost control pattern (post-execution check).
 */

import type { ExecutionRecordRepository } from '../persistence/ExecutionRecordRepository.js';
import type { IQueryMetricsRepository } from '../persistence/types.js';
import { AgentLoader } from '../core/AgentLoader.js';
import { logger } from '../utils/logger.js';
import { EventType } from '../utils/events.js';

export interface BudgetConfig {
  /** Daily budget in cents (e.g., 500 = $5.00). 0 = unlimited */
  dailyCents: number;
  /** Monthly budget in cents (e.g., 10000 = $100.00). 0 = unlimited */
  monthlyCents: number;
  /** Warning threshold as fraction (e.g., 0.8 = warn at 80%) */
  warningThreshold: number;
}

export interface BudgetStatus {
  agentId: string;
  /** Today's spend in cents */
  todayCents: number;
  /** This month's spend in cents */
  monthCents: number;
  /** Configured daily limit */
  dailyLimitCents: number;
  /** Configured monthly limit */
  monthlyLimitCents: number;
  /** Whether agent has exceeded budget */
  exceeded: boolean;
  /** Whether agent is at warning threshold */
  warning: boolean;
  /** Which limit was hit (undefined = not exceeded) */
  exceededReason: 'daily' | 'monthly' | undefined;
}

const log = logger.child({ module: 'BudgetService' });

/** Set of currently paused agent IDs (runtime-only, resets on restart) */
const pausedAgents = new Set<string>();

export class BudgetService {
  private readonly agentLoader: AgentLoader;
  private readonly executionRecordRepo: ExecutionRecordRepository | null;
  private readonly queryMetricsRepo: IQueryMetricsRepository | null;

  constructor(opts: {
    agentLoader: AgentLoader;
    executionRecordRepository?: ExecutionRecordRepository;
    queryMetricsRepository?: IQueryMetricsRepository;
  }) {
    this.agentLoader = opts.agentLoader;
    this.executionRecordRepo = opts.executionRecordRepository ?? null;
    this.queryMetricsRepo = opts.queryMetricsRepository ?? null;
  }

  /**
   * Get budget config for an agent. Returns null if no budget configured.
   */
  getBudgetConfig(agentId: string): BudgetConfig | null {
    const agent = this.agentLoader.get(agentId);
    if (agent === undefined) return null;

    const settings = agent.config.settings;
    const maxBudgetUsd = settings?.maxBudgetUsd;

    // Use maxBudgetUsd as monthly budget (existing field), or 0 if not set
    if (maxBudgetUsd === undefined || maxBudgetUsd <= 0) return null;

    return {
      dailyCents: 0, // No daily limit by default (can be extended later)
      monthlyCents: Math.round(maxBudgetUsd * 100),
      warningThreshold: 0.8,
    };
  }

  /**
   * Check budget status for an agent.
   * Uses query_metrics table (existing) for cost data since execution_records
   * may not have all historical data yet.
   */
  checkBudget(agentId: string): BudgetStatus | null {
    const config = this.getBudgetConfig(agentId);
    if (config === null) {
      return null; // No budget configured
    }

    // Calculate time boundaries
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    let todayCents = 0;
    let monthCents = 0;

    // Try execution_records first (newer, uses cents)
    if (this.executionRecordRepo !== null) {
      todayCents = this.executionRecordRepo.getCostSince(agentId, todayStart);
      monthCents = this.executionRecordRepo.getCostSince(agentId, monthStart);
    }

    // Fallback: also check query_metrics (historical data in USD float)
    if (this.queryMetricsRepo !== null && monthCents === 0) {
      try {
        const monthlyStats = this.queryMetricsRepo.getAgentStatsSince(agentId, monthStart);
        if (monthlyStats !== null) {
          monthCents = Math.max(monthCents, Math.round((monthlyStats.totalCostUsd ?? 0) * 100));
        }
      } catch {
        // Ignore — best effort
      }
    }

    const dailyExceeded = config.dailyCents > 0 && todayCents >= config.dailyCents;
    const monthlyExceeded = config.monthlyCents > 0 && monthCents >= config.monthlyCents;
    const exceeded = dailyExceeded || monthlyExceeded;

    const dailyWarning = config.dailyCents > 0 && todayCents >= config.dailyCents * config.warningThreshold;
    const monthlyWarning = config.monthlyCents > 0 && monthCents >= config.monthlyCents * config.warningThreshold;
    const warning = (dailyWarning || monthlyWarning) && !exceeded;

    return {
      agentId,
      todayCents,
      monthCents,
      dailyLimitCents: config.dailyCents,
      monthlyLimitCents: config.monthlyCents,
      exceeded,
      warning,
      exceededReason: dailyExceeded ? 'daily' : monthlyExceeded ? 'monthly' : undefined,
    };
  }

  /**
   * Check if an agent is currently paused due to budget.
   */
  isAgentPaused(agentId: string): boolean {
    return pausedAgents.has(agentId);
  }

  /**
   * Pause an agent due to budget exceeded.
   */
  pauseAgent(agentId: string, reason: string): void {
    if (pausedAgents.has(agentId)) return;
    pausedAgents.add(agentId);
    log.warn({ event_type: EventType.BUDGET_PAUSED_AGENT, agentId, reason }, 'Agent paused due to budget exceeded');
  }

  /**
   * Resume a paused agent (manual override).
   */
  resumeAgent(agentId: string): void {
    if (!pausedAgents.has(agentId)) return;
    pausedAgents.delete(agentId);
    log.info({ event_type: EventType.BUDGET_RESUMED_AGENT, agentId }, 'Agent resumed from budget pause');
  }

  /**
   * Post-query budget check. Call after every SDK query.
   * Returns the status; caller decides whether to send alerts.
   */
  postQueryCheck(agentId: string): BudgetStatus | null {
    const status = this.checkBudget(agentId);
    if (status === null) return null;

    if (status.exceeded && !this.isAgentPaused(agentId)) {
      this.pauseAgent(agentId, `Budget exceeded: ${status.exceededReason}`);
    }

    return status;
  }

  /**
   * Pre-query check. Returns true if the agent is allowed to query.
   */
  canQuery(agentId: string): boolean {
    return !this.isAgentPaused(agentId);
  }

  /**
   * Get all paused agents
   */
  getPausedAgents(): string[] {
    return Array.from(pausedAgents);
  }
}
