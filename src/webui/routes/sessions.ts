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
   * GET /sessions - List all sessions (including expired ones from DB)
   */
  router.get('/', (req, res) => {
    const { sessionManager, agentLoader, sessionRepository } = getDeps(req);

    // Get active sessions from memory
    const memorySessions = sessionManager.getAllSessions();
    const memorySessionIds = new Set(memorySessions.map((s) => s.sessionId));

    // Build combined session list
    interface SessionDisplay {
      sessionId: string;
      platform: string;
      userId: string;
      agentId: string;
      agentName: string;
      state: string;
      createdAt: Date;
      lastActiveAt: Date;
      messageCount: number;
      isExpired: boolean;
    }

    const allSessions: SessionDisplay[] = memorySessions.map((s) => {
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
        allSessions.push({
          sessionId: row.session_id,
          platform: row.platform,
          userId: row.user_id,
          agentId: row.agent_id,
          agentName: agent?.config.name ?? row.agent_id,
          state: row.state,
          createdAt: new Date(row.created_at),
          lastActiveAt: new Date(row.last_active_at),
          messageCount,
          isExpired: true,
        });
      }
    }

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

    // Get filter options
    const platforms = [...new Set(allSessions.map((s) => s.platform))];
    const agents = agentLoader.list().map((id) => ({
      id,
      name: agentLoader.get(id)?.config.name ?? id,
    }));
    const states = ['idle', 'processing', 'error'];

    res.render('sessions/list', {
      title: 'Sessions',
      sessions,
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
      filteredCount: sessions.length,
    });
  });

  /**
   * GET /sessions/:id - Show session details (including expired sessions from DB)
   */
  router.get('/:id', (req, res, next) => {
    const { sessionManager, agentLoader, conversationRepository, sessionRepository } = getDeps(req);
    const { id } = req.params;

    // Try to find session in memory first
    const memorySession = findSessionById(sessionManager, id);
    
    // Session data for display
    let sessionData: {
      sessionId: string;
      platform: string;
      userId: string;
      agentId: string;
      agentName: string;
      state: string;
      createdAt: Date;
      lastActiveAt: Date;
      sdkSessionId?: string;
      messageCount: number;
      isExpired: boolean;
    };

    if (memorySession) {
      const agent = agentLoader.get(memorySession.agentId);
      const data: typeof sessionData = {
        sessionId: memorySession.sessionId,
        platform: memorySession.platform,
        userId: memorySession.userId,
        agentId: memorySession.agentId,
        agentName: agent?.config.name ?? memorySession.agentId,
        state: memorySession.state,
        createdAt: memorySession.createdAt,
        lastActiveAt: memorySession.lastActiveAt,
        messageCount: memorySession.processedMessageIds.size,
        isExpired: false,
      };
      if (memorySession.sdkSessionId !== undefined) {
        data.sdkSessionId = memorySession.sdkSessionId;
      }
      sessionData = data;
    } else if (sessionRepository !== undefined) {
      // Try to find in DB (expired session)
      const dbSession = sessionRepository.findBySessionId(id);
      if (!dbSession) {
        next(new NotFoundError('Session'));
        return;
      }
      // Get message count from conversations
      let messageCount = 0;
      if (conversationRepository !== undefined) {
        messageCount = conversationRepository.getMessageCount(id);
      }
      const agent = agentLoader.get(dbSession.agent_id);
      const data: typeof sessionData = {
        sessionId: dbSession.session_id,
        platform: dbSession.platform,
        userId: dbSession.user_id,
        agentId: dbSession.agent_id,
        agentName: agent?.config.name ?? dbSession.agent_id,
        state: dbSession.state,
        createdAt: new Date(dbSession.created_at),
        lastActiveAt: new Date(dbSession.last_active_at),
        messageCount,
        isExpired: true,
      };
      if (dbSession.sdk_session_id !== null) {
        data.sdkSessionId = dbSession.sdk_session_id;
      }
      sessionData = data;
    } else {
      next(new NotFoundError('Session'));
      return;
    }

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
      session: sessionData,
      conversations,
    });
  });

  return router;
}
