import type { AgentLoader } from '../../core/AgentLoader.js';
import type { SessionManager } from '../../core/SessionManager.js';
import type { ISessionRepository, IConversationRepository } from '../../persistence/types.js';
import type { DashboardStats } from '../types.js';

/**
 * Service for calculating dashboard statistics
 */
export class StatsService {
  constructor(
    private readonly agentLoader: AgentLoader,
    private readonly sessionManager: SessionManager,
    private readonly sessionRepository?: ISessionRepository,
    private readonly conversationRepository?: IConversationRepository
  ) {}

  /**
   * Get dashboard statistics
   */
  getDashboardStats(): DashboardStats {
    const agents = this.agentLoader.list();
    const sessions = this.sessionManager.getAllSessions();

    const activeSessions = sessions.filter(
      (s) => s.state === 'idle' || s.state === 'processing'
    ).length;

    let totalConversations = 0;

    // If we have persistence, count conversations
    if (this.conversationRepository !== undefined) {
      // Count messages for each session
      for (const session of sessions) {
        const messages = this.conversationRepository.findBySessionId(session.sessionId);
        totalConversations += messages.length;
      }
    }

    return {
      totalAgents: agents.length,
      activeSessions,
      totalSessions: sessions.length,
      totalConversations,
      systemStatus: 'running',
    };
  }

  /**
   * Get sessions grouped by agent
   */
  getSessionsByAgent(): Record<string, number> {
    const sessions = this.sessionManager.getAllSessions();
    const grouped: Record<string, number> = {};

    for (const session of sessions) {
      const agentId = session.agentId;
      grouped[agentId] = (grouped[agentId] ?? 0) + 1;
    }

    return grouped;
  }

  /**
   * Get sessions grouped by platform
   */
  getSessionsByPlatform(): Record<string, number> {
    const sessions = this.sessionManager.getAllSessions();
    const grouped: Record<string, number> = {};

    for (const session of sessions) {
      const platform = session.platform;
      grouped[platform] = (grouped[platform] ?? 0) + 1;
    }

    return grouped;
  }

  /**
   * Get recent activity stats
   */
  getRecentActivity(hours: number = 24): {
    newSessions: number;
    activeUsers: number;
  } {
    const sessions = this.sessionManager.getAllSessions();
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const recentSessions = sessions.filter((s) => s.createdAt >= cutoff);
    const activeUsers = new Set(sessions.map((s) => `${s.platform}::${s.userId}`)).size;

    return {
      newSessions: recentSessions.length,
      activeUsers,
    };
  }
}
