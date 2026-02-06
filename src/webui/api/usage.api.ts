import { Router } from 'express';
import type { WebUIRequest } from '../types.js';

/**
 * Create usage API router
 */
export function createUsageApiRouter(): Router {
  const router = Router();

  /**
   * GET /api/usage/daily?days=N&agent=X
   * Returns daily aggregated stats for trend chart
   */
  router.get('/daily', (req, res) => {
    const { queryMetricsRepository } =
      (req as WebUIRequest).dependencies;

    if (queryMetricsRepository === undefined) {
      res.json({ daily: [] });
      return;
    }

    const days = Math.min(
      Math.max(parseInt(req.query.days as string, 10) || 7, 1),
      365
    );
    const agentId = req.query.agent as string | undefined;

    const daily = agentId
      ? queryMetricsRepository.getDailyStats(agentId, days)
      : queryMetricsRepository.getDailyStatsAll(days);

    res.json({ daily });
  });

  /**
   * GET /api/usage/recent?limit=N&offset=M&agent=X
   * Returns individual query records for detail list
   */
  router.get('/recent', (req, res) => {
    const { queryMetricsRepository } =
      (req as WebUIRequest).dependencies;

    if (queryMetricsRepository === undefined) {
      res.json({ queries: [], hasMore: false });
      return;
    }

    const limit = Math.min(
      Math.max(parseInt(req.query.limit as string, 10) || 20, 1),
      100
    );
    const offset = Math.max(
      parseInt(req.query.offset as string, 10) || 0,
      0
    );
    const agentId = req.query.agent as string | undefined;

    const queries = queryMetricsRepository.getRecentQueries(
      limit + 1,
      offset,
      agentId
    );

    const hasMore = queries.length > limit;
    if (hasMore) {
      queries.pop();
    }

    res.json({ queries, hasMore });
  });

  return router;
}
