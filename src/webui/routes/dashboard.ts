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
    const {
      agentLoader,
      sessionManager,
      sessionRepository,
      conversationRepository,
      monitoringService,
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

    // Get agent list for quick access
    const agents = agentLoader.list().map((id) => {
      const agent = agentLoader.get(id);
      return {
        id,
        name: agent?.config.name ?? id,
        description: agent?.config.description ?? '',
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
    });
  });

  return router;
}
