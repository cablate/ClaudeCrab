import { Router } from 'express';
import type { WebUIRequest } from '../types.js';
import type { SSEBroadcaster } from '../services/SSEBroadcaster.js';
import type { ActivityService } from '../../core/ActivityService.js';
import type { AgentLoader } from '../../core/AgentLoader.js';

/**
 * Create the activity API router (v2.0 Characters Come Alive).
 *
 * Endpoints:
 * - GET /api/activity/stream — SSE event stream
 * - GET /api/activity/events — Recent events (JSON)
 * - GET /api/activity/agents — All agent states (JSON)
 */
export function createActivityApiRouter(
  sseBroadcaster: SSEBroadcaster,
  activityService: ActivityService,
  agentLoader: AgentLoader,
): Router {
  const router = Router();

  // SSE stream
  router.get('/stream', (req, res) => {
    sseBroadcaster.addClient(res);

    // Send recent events as initial batch
    const recent = activityService.getRecent(30);
    for (const event of recent) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  });

  // Recent events (supports ?agentId=&type=&since=&limit= filters)
  router.get('/events', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const filters: { agentId?: string; type?: string; since?: string } = {};
    if (typeof req.query.agentId === 'string') filters.agentId = req.query.agentId;
    if (typeof req.query.type === 'string') filters.type = req.query.type;
    if (typeof req.query.since === 'string') filters.since = req.query.since;

    const events = activityService.getRecent(limit, filters);
    res.json({ events });
  });

  // All agent states
  router.get('/agents', (_req, res) => {
    const agentIds = agentLoader.list();
    const states = agentIds.map(agentId => {
      const agent = agentLoader.get(agentId);
      const state = activityService.getAgentState(agentId);
      const config = agent?.config as Record<string, unknown> | undefined;
      const display = config?.display as
        | { avatar?: string; color?: string }
        | undefined;
      return {
        id: agentId,
        name: (config?.name as string) ?? agentId,
        avatar: display?.avatar ?? '🤖',
        color: display?.color ?? '#6B7280',
        ...state,
      };
    });
    res.json({ agents: states });
  });

  return router;
}
