import { Router } from 'express';
import type { Request } from 'express';
import type { WebUIRequest, WebUIDependencies } from '../types.js';
import type { UserSession } from '../../types/session.js';

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
 * Create sessions API router
 */
export function createSessionsApiRouter(): Router {
  const router = Router();

  /**
   * GET /api/sessions - List all sessions (including expired ones from DB)
   */
  router.get('/', (req, res) => {
    const { sessionManager, agentLoader, sessionRepository } = getDeps(req);

    // Get active sessions from memory
    const memorySessions = sessionManager.getAllSessions();
    const memorySessionIds = new Set(memorySessions.map((s) => s.sessionId));

    // Build session list from memory sessions
    const sessions = memorySessions.map((s) => {
      const agent = agentLoader.get(s.agentId);
      return {
        sessionId: s.sessionId,
        platform: s.platform,
        userId: s.userId,
        agentId: s.agentId,
        agentName: agent?.config.name ?? s.agentId,
        state: s.state,
        createdAt: s.createdAt.toISOString(),
        lastActiveAt: s.lastActiveAt.toISOString(),
        messageCount: s.processedMessageIds.size,
        isExpired: false,
      };
    });

    // Add expired sessions from DB (if persistence is enabled)
    if (sessionRepository !== undefined) {
      const { conversationRepository } = getDeps(req);
      const dbSessions = sessionRepository.findAll();
      for (const row of dbSessions) {
        // Skip sessions already in memory
        if (memorySessionIds.has(row.session_id)) {
          continue;
        }

        // Get message count from conversations
        let messageCount = 0;
        if (conversationRepository !== undefined) {
          messageCount = conversationRepository.getMessageCount(row.session_id);
        }

        const agent = agentLoader.get(row.agent_id);
        sessions.push({
          sessionId: row.session_id,
          platform: row.platform,
          userId: row.user_id,
          agentId: row.agent_id,
          agentName: agent?.config.name ?? row.agent_id,
          state: row.state as 'idle' | 'processing',
          createdAt: row.created_at,
          lastActiveAt: row.last_active_at,
          messageCount,
          isExpired: true,
        });
      }
    }

    // Sort by lastActiveAt descending
    sessions.sort(
      (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
    );

    res.json({
      sessions,
      total: sessions.length,
    });
  });

  /**
   * GET /api/sessions/:id - Get session details
   */
  router.get('/:id', (req, res) => {
    const { sessionManager, agentLoader } = getDeps(req);
    const { id } = req.params;

    const session = findSessionById(sessionManager, id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const agent = agentLoader.get(session.agentId);

    res.json({
      sessionId: session.sessionId,
      platform: session.platform,
      userId: session.userId,
      agentId: session.agentId,
      agentName: agent?.config.name ?? session.agentId,
      state: session.state,
      createdAt: session.createdAt.toISOString(),
      lastActiveAt: session.lastActiveAt.toISOString(),
      sdkSessionId: session.sdkSessionId,
      messageCount: session.processedMessageIds.size,
    });
  });

  /**
   * DELETE /api/sessions/:id - Close a session
   */
  router.delete('/:id', async (req, res) => {
    const { sessionManager } = getDeps(req);
    const { id } = req.params;

    const session = findSessionById(sessionManager, id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    try {
      await sessionManager.closeSession(session.platform, session.agentId, session.userId);
      res.json({
        success: true,
        message: `Session ${id} closed successfully`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to close session';
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/sessions/cleanup - Clean up expired sessions
   */
  router.post('/cleanup', async (req, res) => {
    const { sessionManager } = getDeps(req);

    try {
      // Get count before cleanup
      const beforeCount = sessionManager.getAllSessions().length;

      // Trigger cleanup
      await sessionManager.cleanupExpired();

      const afterCount = sessionManager.getAllSessions().length;
      const cleaned = beforeCount - afterCount;

      res.json({
        success: true,
        message: `Cleanup completed`,
        cleaned,
        remaining: afterCount,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cleanup failed';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
