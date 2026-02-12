import { Router } from 'express';
import type { WebUIRequest } from '../types.js';
import type { SSEBroadcaster } from '../services/SSEBroadcaster.js';
import type { ActivityService } from '../../core/ActivityService.js';
import type { AgentLoader } from '../../core/AgentLoader.js';

/** Default number of recent events to return */
const DEFAULT_EVENTS_LIMIT = 50;
/** Maximum number of events a client can request */
const MAX_EVENTS_LIMIT = 200;

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
    const limit = Math.min(Number(req.query.limit) || DEFAULT_EVENTS_LIMIT, MAX_EVENTS_LIMIT);
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
      const config = agent?.config;
      const display = config?.display;

      // Build asset URLs from display config (relative filenames → full paths)
      const assetBase = `/static/images/agents/${agentId}`;
      const sprite = display?.sprite ? `${assetBase}/${display.sprite}` : null;
      const portrait = display?.portrait ? `${assetBase}/${display.portrait}` : null;
      const emoji = display?.emoji
        ? Object.fromEntries(Object.entries(display.emoji).map(([k, v]) => [k, `${assetBase}/${v}`]))
        : null;

      return {
        id: agentId,
        name: (config?.name as string) ?? agentId,
        description: (config?.description as string) ?? '',
        model: (config?.model as string) ?? 'unknown',
        avatar: display?.avatar ?? '🤖',
        color: display?.color ?? '#6B7280',
        sprite,
        portrait,
        emoji,
        idleDuration: activityService.getIdleDuration(agentId),
        ...state,
      };
    });
    res.json({ agents: states });
  });

  // Today's stats (aggregated from DB)
  router.get('/stats', (_req, res) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const sinceIso = todayStart.toISOString();

    const stats = activityService.getStats(sinceIso);
    if (!stats) {
      res.json({ total: 0, workflow: 0, personality: 0, byAgent: [] });
      return;
    }
    res.json(stats);
  });

  return router;
}
