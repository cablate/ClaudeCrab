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
 * Create conversations router
 */
export function createConversationsRouter(): Router {
  const router = Router();

  /**
   * GET /conversations/:sessionId - View conversation for a session
   */
  router.get('/:sessionId', (req, res, next) => {
    const { sessionManager, agentLoader, conversationRepository } = getDeps(req);
    const { sessionId } = req.params;

    // Try to get session (might be in memory or just in DB)
    const session = findSessionById(sessionManager, sessionId);

    if (!session && conversationRepository === undefined) {
      next(new NotFoundError('Session'));
      return;
    }

    // Get conversation history
    let conversations: Array<{
      role: string;
      content: string;
      createdAt: Date;
      sequenceNumber: number;
    }> = [];

    if (conversationRepository !== undefined) {
      const rows = conversationRepository.findBySessionId(sessionId);

      if (rows.length === 0 && !session) {
        next(new NotFoundError('Conversation'));
        return;
      }

      conversations = rows.map((row) => ({
        role: row.role,
        content: row.content,
        createdAt: new Date(row.created_at),
        sequenceNumber: row.sequence_number,
      }));
    }

    // Get agent info if session exists
    let agentName = 'Unknown';
    if (session) {
      const agent = agentLoader.get(session.agentId);
      agentName = agent?.config.name ?? session.agentId;
    }

    res.render('conversations/view', {
      title: `Conversation - ${sessionId.slice(0, 8)}...`,
      sessionId,
      session: session
        ? {
            platform: session.platform,
            userId: session.userId,
            agentId: session.agentId,
            agentName,
            state: session.state,
            createdAt: session.createdAt,
            lastActiveAt: session.lastActiveAt,
          }
        : null,
      conversations,
      messageCount: conversations.length,
    });
  });

  return router;
}
