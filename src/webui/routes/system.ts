/**
 * System monitoring routes
 *
 * Provides pages for system overview, metrics, events, and audit logs.
 */

import { Router } from 'express';
import type { WebUIRequest } from '../types.js';
import { MonitoringService } from '../services/MonitoringService.js';

/**
 * Create system monitoring router
 */
export function createSystemRouter(): Router {
  const router = Router();

  /**
   * GET /system - System overview page
   */
  router.get('/', (req, res) => {
    const { monitoringService, agentLoader } = (req as WebUIRequest).dependencies;

    let metrics = null;
    let events: Array<{ timestamp: string; type: string; summary: string }> = [];

    if (monitoringService !== undefined) {
      metrics = monitoringService.getMetrics();
      events = monitoringService.getRecentEvents(10);
    }

    const agentCount = agentLoader.list().length;

    res.render('system/index', {
      title: 'System Overview',
      metrics,
      events,
      agentCount,
      formatBytes: MonitoringService.formatBytes,
    });
  });

  /**
   * GET /system/metrics - Detailed metrics page
   */
  router.get('/metrics', (req, res) => {
    const { monitoringService } = (req as WebUIRequest).dependencies;

    let metrics = null;

    if (monitoringService !== undefined) {
      metrics = monitoringService.getMetrics();
    }

    res.render('system/metrics', {
      title: 'System Metrics',
      metrics,
      formatBytes: MonitoringService.formatBytes,
    });
  });

  /**
   * GET /system/events - Event log page
   */
  router.get('/events', (req, res) => {
    const { monitoringService } = (req as WebUIRequest).dependencies;

    let events: Array<{ timestamp: string; type: string; summary: string }> = [];

    if (monitoringService !== undefined) {
      events = monitoringService.getRecentEvents(100);
    }

    res.render('system/events', {
      title: 'Event Log',
      events,
    });
  });

  /**
   * GET /system/audit - Audit log page
   */
  router.get('/audit', (req, res) => {
    const { monitoringService } = (req as WebUIRequest).dependencies;

    let events: Array<{ timestamp: string; type: string; summary: string }> = [];

    if (monitoringService !== undefined) {
      events = monitoringService.getRecentEvents(100);
    }

    res.render('system/audit', {
      title: 'Audit Log',
      events,
    });
  });

  return router;
}
