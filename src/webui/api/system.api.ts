/**
 * System Monitoring API
 *
 * Provides endpoints for system metrics, events, and audit logs.
 */

import { Router } from 'express';
import type { WebUIRequest } from '../types.js';
import { MonitoringService } from '../services/MonitoringService.js';

/**
 * Create system monitoring API router
 */
export function createSystemApiRouter(): Router {
  const router = Router();

  /**
   * GET /api/system/metrics - Get system metrics
   */
  router.get('/metrics', (req, res) => {
    const { monitoringService } = (req as WebUIRequest).dependencies;

    if (monitoringService === undefined) {
      res.status(503).json({ error: 'Monitoring service not available' });
      return;
    }

    const metrics = monitoringService.getMetrics();

    res.json({
      uptime: metrics.uptime,
      uptimeFormatted: metrics.uptimeFormatted,
      memory: {
        heapUsed: metrics.memory.heapUsed,
        heapUsedFormatted: MonitoringService.formatBytes(metrics.memory.heapUsed),
        heapTotal: metrics.memory.heapTotal,
        heapTotalFormatted: MonitoringService.formatBytes(metrics.memory.heapTotal),
        rss: metrics.memory.rss,
        rssFormatted: MonitoringService.formatBytes(metrics.memory.rss),
        external: metrics.memory.external,
        externalFormatted: MonitoringService.formatBytes(metrics.memory.external),
      },
      sessions: {
        active: metrics.activeSessions,
        processing: metrics.processingSessions,
      },
      bots: {
        running: metrics.botsRunning,
        stopped: metrics.botsStopped,
        error: metrics.botsError,
        total: metrics.botStatus.length,
      },
    });
  });

  /**
   * GET /api/system/bots - Get all bot statuses
   */
  router.get('/bots', (req, res) => {
    const { monitoringService } = (req as WebUIRequest).dependencies;

    if (monitoringService === undefined) {
      res.status(503).json({ error: 'Monitoring service not available' });
      return;
    }

    const botStatus = monitoringService.getBotStatus();

    res.json({ bots: botStatus });
  });

  /**
   * GET /api/system/sessions/processing - Get processing sessions
   */
  router.get('/sessions/processing', (req, res) => {
    const { monitoringService } = (req as WebUIRequest).dependencies;

    if (monitoringService === undefined) {
      res.status(503).json({ error: 'Monitoring service not available' });
      return;
    }

    const sessions = monitoringService.getProcessingSessions();

    res.json({ sessions });
  });

  /**
   * GET /api/system/events - Get recent events
   */
  router.get('/events', (req, res) => {
    const { monitoringService } = (req as WebUIRequest).dependencies;

    if (monitoringService === undefined) {
      res.status(503).json({ error: 'Monitoring service not available' });
      return;
    }

    const limit = Math.min(
      parseInt(req.query.limit as string) || 20,
      100
    );

    const events = monitoringService.getRecentEvents(limit);

    res.json({ events });
  });

  /**
   * GET /api/system/audit - Get audit logs\n   * Returns recent system events from in-memory monitoring service.
   */
  router.get('/audit', (req, res) => {
    const { monitoringService } = (req as WebUIRequest).dependencies;

    if (monitoringService === undefined) {
      res.status(503).json({ error: 'Monitoring service not available' });
      return;
    }

    const limit = Math.min(
      parseInt(req.query.limit as string) || 50,
      200
    );

    const events = monitoringService.getRecentEvents(limit);

    res.json({
      logs: events.map((e) => ({
        timestamp: e.timestamp,
        action: e.type,
        details: e.summary,
        source: 'system',
      })),

    });
  });

  /**
   * GET /api/system/health - Health check endpoint
   */
  router.get('/health', (req, res) => {
    const { monitoringService, agentLoader, sessionManager } = (
      req as WebUIRequest
    ).dependencies;

    const checks = {
      agentLoader: agentLoader !== undefined,
      sessionManager: sessionManager !== undefined,
      monitoringService: monitoringService !== undefined,
    };

    const healthy = Object.values(checks).every((v) => v);

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
