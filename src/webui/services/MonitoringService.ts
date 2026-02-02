/**
 * MonitoringService - Provides system monitoring data for WebUI
 *
 * Collects runtime metrics: uptime, memory, bot status, active sessions,
 * recent events. Designed for dashboard monitoring and system health checks.
 */

import type { SessionManager } from '../../core/SessionManager.js';
import type { PlatformOrchestrator } from '../../core/PlatformOrchestrator.js';
import type { AgentLoader } from '../../core/AgentLoader.js';

/**
 * System memory metrics
 */
export interface MemoryMetrics {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
}

/**
 * Bot status information
 */
export interface BotStatusInfo {
  agentId: string;
  agentName: string;
  platform: string;
  status: 'running' | 'stopped' | 'error' | 'no-token';
}

/**
 * Active query information (simplified for monitoring)
 */
export interface ActiveQueryInfo {
  sessionId: string;
  agentId: string;
  startedAt: string;
  durationMs: number;
}

/**
 * Recent event record
 */
export interface EventRecord {
  timestamp: string;
  type: string;
  summary: string;
}

/**
 * Complete system metrics
 */
export interface SystemMetrics {
  uptime: number;
  uptimeFormatted: string;
  memory: MemoryMetrics;
  activeSessions: number;
  processingSessions: number;
  botStatus: BotStatusInfo[];
  botsRunning: number;
  botsStopped: number;
  botsError: number;
}

/**
 * MonitoringService options
 */
export interface MonitoringServiceOptions {
  sessionManager: SessionManager;
  platformOrchestrator: PlatformOrchestrator | undefined;
  agentLoader: AgentLoader;
}

/**
 * Service for collecting system monitoring data
 */
export class MonitoringService {
  private readonly sessionManager: SessionManager;
  private readonly platformOrchestrator: PlatformOrchestrator | undefined;
  private readonly agentLoader: AgentLoader;
  private readonly startTime: number;
  private readonly recentEvents: EventRecord[] = [];
  private readonly maxRecentEvents = 100;

  constructor(options: MonitoringServiceOptions) {
    this.sessionManager = options.sessionManager;
    this.platformOrchestrator = options.platformOrchestrator;
    this.agentLoader = options.agentLoader;
    this.startTime = Date.now();
  }

  /**
   * Record an event for the event log
   */
  recordEvent(type: string, summary: string): void {
    const event: EventRecord = {
      timestamp: new Date().toISOString(),
      type,
      summary,
    };

    this.recentEvents.unshift(event);

    // Keep only recent events
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.pop();
    }
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit: number = 20): EventRecord[] {
    return this.recentEvents.slice(0, limit);
  }

  /**
   * Get complete system metrics
   */
  getMetrics(): SystemMetrics {
    const memory = process.memoryUsage();
    const uptime = Date.now() - this.startTime;

    // Get all sessions
    const allSessions = this.sessionManager.getAllSessions();
    const processingSessions = allSessions.filter(
      (s) => s.state === 'processing'
    ).length;

    // Get bot status for all agents
    const botStatus = this.getBotStatus();
    const botsRunning = botStatus.filter((b) => b.status === 'running').length;
    const botsStopped = botStatus.filter((b) => b.status === 'stopped').length;
    const botsError = botStatus.filter((b) => b.status === 'error').length;

    return {
      uptime,
      uptimeFormatted: this.formatUptime(uptime),
      memory: {
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        rss: memory.rss,
        external: memory.external,
      },
      activeSessions: allSessions.length,
      processingSessions,
      botStatus,
      botsRunning,
      botsStopped,
      botsError,
    };
  }

  /**
   * Get bot status for all agents
   */
  getBotStatus(): BotStatusInfo[] {
    const agents = this.agentLoader.list();
    const result: BotStatusInfo[] = [];

    for (const agentId of agents) {
      const agent = this.agentLoader.get(agentId);
      if (agent === undefined) continue;

      let status: 'running' | 'stopped' | 'error' | 'no-token' = 'no-token';

      if (agent.config.telegramBotToken !== undefined) {
        if (this.platformOrchestrator !== undefined) {
          status = this.platformOrchestrator.getBotStatusForAgent(agentId);
        } else {
          status = 'stopped';
        }
      }

      result.push({
        agentId,
        agentName: agent.config.name,
        platform: 'telegram',
        status,
      });
    }

    return result;
  }

  /**
   * Get processing sessions (sessions currently handling queries)
   */
  getProcessingSessions(): Array<{
    sessionId: string;
    agentId: string;
    platform: string;
    userId: string;
  }> {
    return this.sessionManager
      .getAllSessions()
      .filter((s) => s.state === 'processing')
      .map((s) => ({
        sessionId: s.sessionId,
        agentId: s.agentId,
        platform: s.platform,
        userId: s.userId,
      }));
  }

  /**
   * Format uptime to human-readable string
   */
  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  /**
   * Format bytes to human-readable string
   */
  static formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}
