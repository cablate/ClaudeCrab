import { Router } from 'express';
import type { WebUIRequest } from '../types.js';
import { StatsService } from '../services/StatsService.js';
import type { AgentUsageStats } from '../../persistence/types.js';

/**
 * Create dashboard router
 */
export function createDashboardRouter(): Router {
  const router = Router();

  /**
   * GET /dashboard - Show dashboard
   */
  router.get('/', (req, res) => {
    const {
      agentLoader,
      sessionManager,
      sessionRepository,
      conversationRepository,
      monitoringService,
      queryMetricsRepository,
    } = (req as WebUIRequest).dependencies;

    const statsService = new StatsService(
      agentLoader,
      sessionManager,
      sessionRepository,
      conversationRepository
    );

    const stats = statsService.getDashboardStats();
    const sessionsByAgent = statsService.getSessionsByAgent();
    const sessionsByPlatform = statsService.getSessionsByPlatform();
    const recentActivity = statsService.getRecentActivity(24);

    // ADR-020 Phase 2: Get agent usage stats for last 24 hours
    let agentUsageStats: AgentUsageStats[] = [];
    let todayCostUsd = 0;
    if (queryMetricsRepository !== undefined) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      agentUsageStats = queryMetricsRepository.getAllAgentStatsSince(since);
      todayCostUsd = agentUsageStats.reduce(
        (sum, s) => sum + s.totalCostUsd,
        0
      );
    }

    // Build agent usage map for easy lookup in template
    const agentUsageMap = new Map<string, AgentUsageStats>();
    for (const stat of agentUsageStats) {
      agentUsageMap.set(stat.agentId, stat);
    }

    // Get agent list for quick access
    const agents = agentLoader.list().map((id) => {
      const agent = agentLoader.get(id);
      const usage = agentUsageMap.get(id);
      return {
        id,
        name: agent?.config.name ?? id,
        description: agent?.config.description ?? '',
        usage: usage ?? null,
      };
    });

    // Get bot status and recent events from monitoring service
    let botStatus: Array<{
      agentId: string;
      agentName: string;
      platform: string;
      status: string;
    }> = [];
    let recentEvents: Array<{
      timestamp: string;
      type: string;
      summary: string;
    }> = [];
    let processingSessions = 0;

    if (monitoringService !== undefined) {
      botStatus = monitoringService.getBotStatus();
      recentEvents = monitoringService.getRecentEvents(5);
      processingSessions = monitoringService
        .getProcessingSessions()
        .length;
    }

    res.render('dashboard/index', {
      title: 'Dashboard',
      stats,
      sessionsByAgent,
      sessionsByPlatform,
      recentActivity,
      agents,
      botStatus,
      recentEvents,
      processingSessions,
      todayCostUsd,
    });
  });

  return router;
}
