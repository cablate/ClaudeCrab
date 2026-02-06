import { Router } from 'express';
import type { WebUIRequest } from '../types.js';
import type { AgentUsageStats } from '../../persistence/types.js';

/**
 * Map period string to milliseconds offset
 */
function periodToMs(period: string): number | null {
  switch (period) {
    case '24h':
      return 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return 30 * 24 * 60 * 60 * 1000;
    case 'all':
      return null;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

/**
 * Create usage page router
 */
export function createUsageRouter(): Router {
  const router = Router();

  /**
   * GET /usage - Show usage overview page
   */
  router.get('/', (req, res) => {
    const { queryMetricsRepository, agentLoader } =
      (req as WebUIRequest).dependencies;

    const period = (req.query.period as string) || '24h';
    const ms = periodToMs(period);

    let agentStats: AgentUsageStats[] = [];
    let totalCost = 0;
    let totalQueries = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    if (queryMetricsRepository !== undefined) {
      if (ms !== null) {
        const since = new Date(Date.now() - ms).toISOString();
        agentStats = queryMetricsRepository.getAllAgentStatsSince(since);
      } else {
        agentStats = queryMetricsRepository.getAllAgentStats();
      }
      totalCost = agentStats.reduce((sum, s) => sum + s.totalCostUsd, 0);
      totalQueries = agentStats.reduce((sum, s) => sum + s.totalQueries, 0);
      totalInputTokens = agentStats.reduce(
        (sum, s) => sum + s.totalInputTokens,
        0
      );
      totalOutputTokens = agentStats.reduce(
        (sum, s) => sum + s.totalOutputTokens,
        0
      );
    }

    // Enrich agent stats with agent names
    const enrichedStats = agentStats.map((s) => {
      const agent = agentLoader.get(s.agentId);
      return {
        ...s,
        agentName: agent?.config.name ?? s.agentId,
      };
    });

    res.render('usage/index', {
      title: 'Usage',
      period,
      agentStats: enrichedStats,
      totalCost,
      totalQueries,
      totalInputTokens,
      totalOutputTokens,
    });
  });

  return router;
}
