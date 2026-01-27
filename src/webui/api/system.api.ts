import { Router } from 'express';
import type { WebUIRequest } from '../types.js';
import { StatsService } from '../services/StatsService.js';

/**
 * Create system API router
 */
export function createSystemApiRouter(): Router {
  const router = Router();

  /**
   * GET /api/system/stats - Get system statistics
   */
  router.get('/stats', (req, res) => {
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

    res.json({
      stats,
      sessionsByAgent,
      sessionsByPlatform,
      recentActivity,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/system/health - Health check endpoint
   */
  router.get('/health', (req, res) => {
    const { databaseManager } = (req as WebUIRequest).dependencies;

    const health = {
      status: 'healthy' as const,
      timestamp: new Date().toISOString(),
      components: {
        webui: 'up',
        database: databaseManager !== undefined ? 'up' : 'not configured',
      },
    };

    res.json(health);
  });

  /**
   * POST /api/system/database/vacuum - Run database maintenance
   */
  router.post('/database/vacuum', (req, res) => {
    const { databaseManager } = (req as WebUIRequest).dependencies;

    if (databaseManager === undefined) {
      res.status(400).json({ error: 'Database not configured' });
      return;
    }

    try {
      const db = databaseManager.getDatabase();
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.pragma('vacuum');

      res.json({
        success: true,
        message: 'Database maintenance completed',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Database maintenance failed';
      res.status(500).json({ error: message });
    }
  });

  /**
   * GET /api/system/env - Get safe environment info (non-sensitive)
   */
  router.get('/env', (_req, res) => {
    res.json({
      nodeVersion: process.version,
      platform: process.platform,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      env: {
        NODE_ENV: process.env.NODE_ENV ?? 'development',
        WEBUI_PORT: process.env.WEBUI_PORT ?? '3001',
        ENABLE_PERSISTENCE: process.env.ENABLE_PERSISTENCE ?? 'false',
        DEFAULT_AGENT: process.env.DEFAULT_AGENT ?? 'general',
      },
    });
  });

  return router;
}
