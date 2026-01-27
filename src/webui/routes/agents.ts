import { Router } from 'express';
import type { Request } from 'express';
import type { WebUIRequest, WebUIDependencies } from '../types.js';
import { NotFoundError } from '../middleware/errorHandler.js';

/**
 * Helper to get dependencies from request
 */
function getDeps(req: Request): WebUIDependencies {
  return (req as WebUIRequest).dependencies;
}

/**
 * Create agents router
 */
export function createAgentsRouter(): Router {
  const router = Router();

  /**
   * GET /agents - List all agents
   */
  router.get('/', (req, res) => {
    const { agentLoader, sessionManager } = getDeps(req);

    const agentIds = agentLoader.list();
    const sessions = sessionManager.getAllSessions();

    // Build agent list with session counts
    const agents = agentIds.map((id) => {
      const agent = agentLoader.get(id);
      const sessionCount = sessions.filter((s) => s.agentId === id).length;

      return {
        id,
        name: agent?.config.name ?? id,
        description: agent?.config.description ?? '',
        version: agent?.config.version ?? '1.0.0',
        model: agent?.config.model ?? 'sonnet',
        sessionCount,
        path: agent?.path ?? '',
      };
    });

    res.render('agents/list', {
      title: 'Agents',
      agents,
    });
  });

  /**
   * GET /agents/:id - Show agent details
   */
  router.get('/:id', (req, res, next) => {
    const { agentLoader, sessionManager } = getDeps(req);
    const { id } = req.params;

    const agent = agentLoader.get(id);
    if (!agent) {
      next(new NotFoundError('Agent'));
      return;
    }

    // Get sessions for this agent
    const allSessions = sessionManager.getAllSessions();
    const sessions = allSessions
      .filter((s) => s.agentId === id)
      .map((s) => ({
        sessionId: s.sessionId,
        platform: s.platform,
        userId: s.userId,
        state: s.state,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
      }));

    res.render('agents/detail', {
      title: agent.config.name ?? id,
      agent: {
        id: agent.id,
        name: agent.config.name,
        description: agent.config.description,
        version: agent.config.version,
        model: agent.config.model,
        path: agent.path,
        systemPrompt: agent.systemPrompt,
        config: agent.config,
      },
      sessions,
    });
  });

  return router;
}
