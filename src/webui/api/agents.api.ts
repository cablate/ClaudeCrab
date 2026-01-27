import { Router } from 'express';
import type { Request } from 'express';
import type { WebUIRequest, WebUIDependencies } from '../types.js';

/**
 * Helper to get dependencies from request
 */
function getDeps(req: Request): WebUIDependencies {
  return (req as WebUIRequest).dependencies;
}

/**
 * Create agents API router
 */
export function createAgentsApiRouter(): Router {
  const router = Router();

  /**
   * GET /api/agents - List all agents
   */
  router.get('/', (req, res) => {
    const { agentLoader, platformOrchestrator } = getDeps(req);

    const agentIds = agentLoader.list();
    const runningAdapters = platformOrchestrator?.getRunningAdapters() ?? [];

    const agents = agentIds.map((id) => {
      const agent = agentLoader.get(id);
      const adapters = runningAdapters.filter((a) => a.agentId === id);
      return {
        id,
        name: agent?.config.name ?? id,
        description: agent?.config.description ?? '',
        version: agent?.config.version ?? '1.0.0',
        model: agent?.config.model ?? 'sonnet',
        botStatus: adapters.map((a) => ({ platform: a.platform, status: a.status })),
      };
    });

    res.json({ agents });
  });

  /**
   * GET /api/agents/:id - Get agent details
   */
  router.get('/:id', (req, res) => {
    const { agentLoader } = getDeps(req);
    const { id } = req.params;

    const agent = agentLoader.get(id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    res.json({
      id: agent.id,
      name: agent.config.name,
      description: agent.config.description,
      version: agent.config.version,
      model: agent.config.model,
      path: agent.path,
      config: agent.config,
    });
  });

  /**
   * POST /api/agents/:id/reload - Reload agent configuration and restart adapters
   */
  router.post('/:id/reload', async (req, res) => {
    const { agentLoader, platformOrchestrator } = getDeps(req);
    const { id } = req.params;

    try {
      // Check if agent exists
      const existing = agentLoader.get(id);
      if (!existing) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      // Reload agent via orchestrator (config + adapter restart) or just config
      if (platformOrchestrator !== undefined) {
        await platformOrchestrator.reloadAgent(id);
      } else {
        await agentLoader.loadAgent(id);
      }

      const reloaded = agentLoader.get(id);
      res.json({
        success: true,
        message: `Agent ${id} reloaded successfully`,
        agent: {
          id: reloaded?.id,
          name: reloaded?.config.name,
          version: reloaded?.config.version,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reload agent';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
