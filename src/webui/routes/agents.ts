import { Router } from 'express';
import type { Request } from 'express';
import type { WebUIRequest, WebUIDependencies } from '../types.js';
import { NotFoundError } from '../middleware/errorHandler.js';
import fs from 'node:fs';
import path from 'node:path';

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
    const { agentLoader, sessionManager, platformOrchestrator } = getDeps(req);

    const agentIds = agentLoader.list();
    const sessions = sessionManager.getAllSessions();
    const runningAdapters = platformOrchestrator?.getRunningAdapters() ?? [];

    // Build agent list with session counts and bot status
    const agents = agentIds.map((id) => {
      const agent = agentLoader.get(id);
      const sessionCount = sessions.filter((s) => s.agentId === id).length;
      const adapters = runningAdapters.filter((a) => a.agentId === id);

      return {
        id,
        name: agent?.config.name ?? id,
        description: agent?.config.description ?? '',
        version: agent?.config.version ?? '1.0.0',
        model: agent?.config.model ?? 'sonnet',
        sessionCount,
        path: agent?.path ?? '',
        botStatus: adapters.length > 0
          ? adapters.map((a) => ({ platform: a.platform, status: a.status }))
          : [],
      };
    });

    res.render('agents/list', {
      title: 'Agents',
      agents,
    });
  });

  /**
   * GET /agents/create - Show create agent form
   */
  router.get('/create', (_req, res) => {
    res.render('agents/create', {
      title: 'Create Agent',
    });
  });

  /**
   * GET /agents/:id/edit - Show edit agent form
   */
  router.get('/:id/edit', (req, res, next) => {
    const { agentLoader } = getDeps(req);
    const { id } = req.params;

    const agent = agentLoader.get(id);
    if (!agent) {
      next(new NotFoundError('Agent'));
      return;
    }

    // Read settings.local.json for permissions and model
    let permissions = { allow: [] as string[], deny: [] as string[] };
    let settingsModel: string | undefined;
    try {
      const settingsPath = path.join(agent.path, '.claude', 'settings.local.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as {
          permissions?: { allow?: string[]; deny?: string[] };
          model?: string;
        };
        if (settings.permissions) {
          permissions = {
            allow: settings.permissions.allow ?? [],
            deny: settings.permissions.deny ?? [],
          };
        }
        if (settings.model) {
          settingsModel = settings.model;
        }
      }
    } catch {
      // Use defaults
    }

    // Model priority: settings.local.json > agent.json > 'sonnet'
    const effectiveModel = settingsModel ?? agent.config.model ?? 'sonnet';

    res.render('agents/edit', {
      title: `Edit ${agent.config.name ?? id}`,
      agent: {
        id: agent.id,
        name: agent.config.name,
        description: agent.config.description ?? '',
        model: effectiveModel,
        telegramBotToken: agent.config.telegramBotToken ?? '',
        discordBotToken: agent.config.discordBotToken ?? '',
        discordChannelId: agent.config.discordChannelId ?? '',
        path: agent.path,
        // Model parameters
        maxTokens: agent.config.maxTokens ?? '',
        maxThinkingTokens: agent.config.maxThinkingTokens ?? '',
        // MCP config
        mcpConfigFile: agent.config.mcpConfigFile ?? '',
        // Settings
        settings: {
          permissionMode: agent.config.settings?.permissionMode ?? '',
          maxTurns: agent.config.settings?.maxTurns ?? '',
          delegation: {
            inbound: agent.config.settings?.delegation?.inbound ?? true,
            outbound: agent.config.settings?.delegation?.outbound ?? true,
          },
          initiative: {
            enabled: agent.config.settings?.initiative?.enabled ?? false,
            mode: agent.config.settings?.initiative?.mode ?? 'work',
            cooldown: agent.config.settings?.initiative?.cooldown ?? 300,
            maxPerHour: agent.config.settings?.initiative?.maxPerHour ?? 5,
          },
        },
      },
      permissions,
    });
  });

  /**
   * GET /agents/:id - Show agent details
   */
  router.get('/:id', (req, res, next) => {
    const { agentLoader, sessionManager, platformOrchestrator, sessionRepository, conversationRepository } = getDeps(req);
    const { id } = req.params;

    const agent = agentLoader.get(id);
    if (!agent) {
      next(new NotFoundError('Agent'));
      return;
    }

    // Get sessions for this agent (including expired ones from DB)
    const memorySessions = sessionManager.getAllSessions().filter((s) => s.agentId === id);
    const memorySessionIds = new Set(memorySessions.map((s) => s.sessionId));

    interface SessionDisplay {
      sessionId: string;
      platform: string;
      userId: string;
      state: string;
      createdAt: Date;
      lastActiveAt: Date;
      messageCount: number;
      isExpired: boolean;
    }

    const sessions: SessionDisplay[] = memorySessions.map((s) => ({
      sessionId: s.sessionId,
      platform: s.platform,
      userId: s.userId,
      state: s.state,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      messageCount: s.processedMessageIds.size,
      isExpired: false,
    }));

    // Add expired sessions from DB
    if (sessionRepository !== undefined) {
      const dbSessions = sessionRepository.findAll().filter((r) => r.agent_id === id);
      for (const row of dbSessions) {
        if (memorySessionIds.has(row.session_id)) {
          continue;
        }
        // Get message count from conversations
        let messageCount = 0;
        if (conversationRepository !== undefined) {
          messageCount = conversationRepository.getMessageCount(row.session_id);
        }
        sessions.push({
          sessionId: row.session_id,
          platform: row.platform,
          userId: row.user_id,
          state: row.state,
          createdAt: new Date(row.created_at),
          lastActiveAt: new Date(row.last_active_at),
          messageCount,
          isExpired: true,
        });
      }
    }

    // Sort by lastActiveAt descending
    sessions.sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());

    // Get running adapters for this agent
    const runningAdapters = platformOrchestrator?.getRunningAdapters() ?? [];
    const botStatus = runningAdapters
      .filter((a) => a.agentId === id)
      .map((a) => ({ platform: a.platform, status: a.status }));

    // Read permissions from settings.local.json
    let permissions = { allow: [] as string[], deny: [] as string[] };
    try {
      const settingsPath = path.join(agent.path, '.claude', 'settings.local.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as {
          permissions?: { allow?: string[]; deny?: string[] };
        };
        if (settings.permissions) {
          permissions = {
            allow: settings.permissions.allow ?? [],
            deny: settings.permissions.deny ?? [],
          };
        }
      }
    } catch {
      // Use default permissions
    }

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
      botStatus,
      telegramBotToken: agent.config.telegramBotToken ?? null,
      discordBotToken: agent.config.discordBotToken ?? null,
      discordChannelId: agent.config.discordChannelId ?? null,
      permissions,
    });
  });

  return router;
}
