import { Router } from 'express';
import type { Request } from 'express';
import type { WebUIRequest, WebUIDependencies } from '../types.js';
import type { UserSession } from '../../types/session.js';
import { NotFoundError } from '../middleware/errorHandler.js';

/**
 * Helper to get dependencies from request
 */
function getDeps(req: Request): WebUIDependencies {
  return (req as WebUIRequest).dependencies;
}

/**
 * Find session by ID from all sessions
 */
function findSessionById(
  sessionManager: WebUIDependencies['sessionManager'],
  sessionId: string
): UserSession | undefined {
  return sessionManager.getAllSessions().find((s) => s.sessionId === sessionId);
}

/**
 * Create sessions router
 */
export function createSessionsRouter(): Router {
  const router = Router();

  /**
   * GET /sessions - List all sessions
   */
  router.get('/', (req, res) => {
    const { sessionManager, agentLoader } = getDeps(req);

    const allSessions = sessionManager.getAllSessions();

    // Apply filters from query params
    const { platform, agentId, state } = req.query as {
      platform?: string;
      agentId?: string;
      state?: string;
    };

    let sessions = allSessions;

    if (platform) {
      sessions = sessions.filter((s) => s.platform === platform);
    }

    if (agentId) {
      sessions = sessions.filter((s) => s.agentId === agentId);
    }

    if (state) {
      sessions = sessions.filter((s) => s.state === state);
    }

    // Sort by lastActiveAt descending
    sessions.sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());

    // Map to display format
    const sessionList = sessions.map((s) => {
      const agent = agentLoader.get(s.agentId);
      return {
        sessionId: s.sessionId,
        platform: s.platform,
        userId: s.userId,
        agentId: s.agentId,
        agentName: agent?.config.name ?? s.agentId,
        state: s.state,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        messageCount: s.processedMessageIds.size,
      };
    });

    // Get filter options
    const platforms = [...new Set(allSessions.map((s) => s.platform))];
    const agents = agentLoader.list().map((id) => ({
      id,
      name: agentLoader.get(id)?.config.name ?? id,
    }));
    const states = ['idle', 'processing', 'error'];

    res.render('sessions/list', {
      title: 'Sessions',
      sessions: sessionList,
      filters: {
        platform,
        agentId,
        state,
      },
      options: {
        platforms,
        agents,
        states,
      },
      totalCount: allSessions.length,
      filteredCount: sessionList.length,
    });
  });

  /**
   * GET /sessions/:id - Show session details
   */
  router.get('/:id', (req, res, next) => {
    const { sessionManager, agentLoader, conversationRepository } = getDeps(req);
    const { id } = req.params;

    const session = findSessionById(sessionManager, id);
    if (!session) {
      next(new NotFoundError('Session'));
      return;
    }

    const agent = agentLoader.get(session.agentId);

    // Get conversation history if available
    let conversations: Array<{
      role: string;
      content: string;
      createdAt: Date;
    }> = [];

    if (conversationRepository !== undefined) {
      const rows = conversationRepository.findBySessionId(id);
      conversations = rows.map((row) => ({
        role: row.role,
        content: row.content,
        createdAt: new Date(row.created_at),
      }));
    }

    res.render('sessions/detail', {
      title: `Session ${id.slice(0, 8)}...`,
      session: {
        sessionId: session.sessionId,
        platform: session.platform,
        userId: session.userId,
        agentId: session.agentId,
        agentName: agent?.config.name ?? session.agentId,
        state: session.state,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        sdkSessionId: session.sdkSessionId,
        messageCount: session.processedMessageIds.size,
      },
      conversations,
    });
  });

  return router;
}
