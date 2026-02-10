import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { createAuthRouter } from './auth.js';
import { createDashboardRouter } from './dashboard.js';
import { createAgentsRouter } from './agents.js';
import { createSessionsRouter } from './sessions.js';
import { createConversationsRouter } from './conversations.js';
import { createSystemRouter } from './system.js';
import { createAgentsApiRouter } from '../api/agents.api.js';
import { createSessionsApiRouter } from '../api/sessions.api.js';
import { createSystemApiRouter } from '../api/system.api.js';
import { createUsageRouter } from './usage.js';
import { createUsageApiRouter } from '../api/usage.api.js';

/**
 * Create the main router with all routes
 */
export function createRouter(): Router {
  const router = Router();

  // Auth routes (no authentication required)
  router.use('/', createAuthRouter());

  // Live page (no authentication — public demo display, v2.0)
  router.get('/live', (_req, res) => {
    res.render('live/index');
  });

  // Apply auth middleware to all other routes
  router.use(authMiddleware);

  // Page routes
  router.use('/dashboard', createDashboardRouter());
  router.use('/agents', createAgentsRouter());
  router.use('/sessions', createSessionsRouter());
  router.use('/conversations', createConversationsRouter());
  router.use('/system', createSystemRouter());
  router.use('/usage', createUsageRouter());

  // API routes
  router.use('/api/agents', createAgentsApiRouter());
  router.use('/api/sessions', createSessionsApiRouter());
  router.use('/api/system', createSystemApiRouter());
  router.use('/api/usage', createUsageApiRouter());

  // Root redirect
  router.get('/', (_req, res) => {
    res.redirect('/dashboard');
  });

  return router;
}
