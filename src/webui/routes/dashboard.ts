import { Router } from 'express';
import type { WebUIRequest } from '../types.js';
import { StatsService } from '../services/StatsService.js';

/**
 * Create dashboard router
 */
export function createDashboardRouter(): Router {
  const router = Router();

  /**
   * GET /dashboard - Show dashboard
   */
  router.get('/', (req, res) => {
    const { agentLoader, sessionManager, sessionRepository, conversationRepository } =
      (req as WebUIRequest).dependencies;

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

    // Get agent list for quick access
    const agents = agentLoader.list().map((id) => {
      const agent = agentLoader.get(id);
      return {
        id,
        name: agent?.config.name ?? id,
        description: agent?.config.description ?? '',
      };
    });

    res.render('dashboard/index', {
      title: 'Dashboard',
      stats,
      sessionsByAgent,
      sessionsByPlatform,
      recentActivity,
      agents,
    });
  });

  return router;
}
