import { Router } from 'express';
import type { Request } from 'express';
import type { WebUIRequest, WebUIDependencies, CreateAgentRequest, UpdateAgentRequest, MemoryFile } from '../types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../utils/logger.js';
import { createAgentSkillsRouter } from './agents-skills.api.js';
import { createAgentSchedulesRouter } from './agents-schedules.api.js';

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
   * POST /api/agents - Create a new agent from template
   */
  router.post('/', async (req, res) => {
    const { agentLoader } = getDeps(req);
    const body = req.body as CreateAgentRequest;

    // Validate required fields
    if (!body.id || !body.name || !body.description || !body.model) {
      res.status(400).json({ error: 'Missing required fields: id, name, description, model' });
      return;
    }

    // Validate ID format (lowercase alphanumeric and hyphens only)
    if (!/^[a-z0-9-]+$/.test(body.id)) {
      res.status(400).json({ error: 'Invalid agent ID. Use only lowercase letters, numbers, and hyphens.' });
      return;
    }

    // Reserved IDs
    if (['_example', 'node_modules', '.git'].includes(body.id)) {
      res.status(400).json({ error: 'Reserved agent ID.' });
      return;
    }

    const agentsDir = path.join(process.cwd(), 'agents');
    const templateDir = path.join(agentsDir, '_example');
    const targetDir = path.join(agentsDir, body.id);

    try {
      // Check if template exists
      try {
        await fs.access(templateDir);
      } catch {
        res.status(500).json({ error: 'Template directory _example not found.' });
        return;
      }

      // Check if target already exists
      try {
        await fs.access(targetDir);
        res.status(409).json({ error: `Agent "${body.id}" already exists.` });
        return;
      } catch {
        // Target doesn't exist, good to proceed
      }

      // Copy template directory recursively
      await fs.cp(templateDir, targetDir, { recursive: true });

      // Update agent.json
      const agentJsonPath = path.join(targetDir, 'agent.json');
      const agentJson = JSON.parse(await fs.readFile(agentJsonPath, 'utf-8')) as Record<string, unknown>;
      agentJson.name = body.name;
      agentJson.description = body.description;
      agentJson.model = body.model;
      if (body.telegramBotToken) {
        agentJson.telegramBotToken = body.telegramBotToken;
      }
      await fs.writeFile(agentJsonPath, JSON.stringify(agentJson, null, 2));

      // Update CLAUDE.md (replace placeholder)
      const claudeMdPath = path.join(targetDir, 'CLAUDE.md');
      let claudeMd = await fs.readFile(claudeMdPath, 'utf-8');
      claudeMd = claudeMd.replace(/\{\{AGENT_NAME\}\}/g, body.name);
      await fs.writeFile(claudeMdPath, claudeMd);

      // Update persona identity.md and soul.md placeholders
      const personaFiles = [
        path.join(targetDir, '.claude', 'skills', 'persona', 'references', 'identity.md'),
        path.join(targetDir, '.claude', 'skills', 'persona', 'references', 'soul.md'),
      ];
      for (const personaFile of personaFiles) {
        try {
          let content = await fs.readFile(personaFile, 'utf-8');
          content = content.replace(/\{\{AGENT_NAME\}\}/g, body.name);
          content = content.replace(/\{\{AGENT_DESCRIPTION\}\}/g, body.description);
          await fs.writeFile(personaFile, content);
        } catch {
          // Persona file doesn't exist in template, skip
        }
      }

      // Update settings.local.json if custom permissions provided
      if (body.permissions) {
        const settingsPath = path.join(targetDir, '.claude', 'settings.local.json');
        const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Record<string, unknown>;
        settings.permissions = body.permissions;
        settings.model = body.model;
        await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
      }

      // Load the new agent
      await agentLoader.loadAgent(body.id);
      const newAgent = agentLoader.get(body.id);

      res.status(201).json({
        success: true,
        agent: {
          id: body.id,
          name: newAgent?.config.name ?? body.name,
          path: targetDir,
        },
      });
    } catch (error) {
      // Cleanup on failure
      try {
        await fs.rm(targetDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      const message = error instanceof Error ? error.message : 'Failed to create agent';
      res.status(500).json({ error: message });
    }
  });

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
        hasBotToken: agent?.config.telegramBotToken !== undefined,
        hasDiscordToken: agent?.config.discordBotToken !== undefined,
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
   * PUT /api/agents/:id - Update an existing agent
   */
  router.put('/:id', async (req, res) => {
    const { agentLoader, platformOrchestrator } = getDeps(req);
    const { id } = req.params;
    const body = req.body as UpdateAgentRequest;

    // Check if agent exists
    const agent = agentLoader.get(id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    try {
      const agentDir = agent.path;

      // Update agent.json
      const agentJsonPath = path.join(agentDir, 'agent.json');
      const agentJson = JSON.parse(await fs.readFile(agentJsonPath, 'utf-8')) as Record<string, unknown>;

      // Basic fields
      if (body.name !== undefined) agentJson.name = body.name;
      if (body.description !== undefined) agentJson.description = body.description;
      if (body.model !== undefined) agentJson.model = body.model;

      // Nullable string fields (null = remove)
      const nullableStringFields = ['telegramBotToken', 'mcpConfigFile'] as const;
      for (const field of nullableStringFields) {
        if (body[field] !== undefined) {
          if (body[field] === null) {
            delete agentJson[field];
          } else {
            agentJson[field] = body[field];
          }
        }
      }

      // Nullable number fields
      const nullableNumberFields = ['maxTokens', 'maxThinkingTokens'] as const;
      for (const field of nullableNumberFields) {
        if (body[field] !== undefined) {
          if (body[field] === null) {
            delete agentJson[field];
          } else {
            agentJson[field] = body[field];
          }
        }
      }

      // Settings object (merge into existing)
      if (body.settings !== undefined) {
        const existingSettings = (agentJson.settings as Record<string, unknown>) ?? {};

        const nullableSettingsFields = ['permissionMode', 'maxTurns'] as const;
        for (const field of nullableSettingsFields) {
          if (body.settings[field] !== undefined) {
            if (body.settings[field] === null) {
              delete existingSettings[field];
            } else {
              existingSettings[field] = body.settings[field];
            }
          }
        }

        // Delegation sub-object
        if (body.settings.delegation !== undefined) {
          if (body.settings.delegation === null) {
            delete existingSettings.delegation;
          } else {
            existingSettings.delegation = body.settings.delegation;
          }
        }

        // Initiative sub-object
        if (body.settings.initiative !== undefined) {
          if (body.settings.initiative === null) {
            delete existingSettings.initiative;
          } else {
            existingSettings.initiative = body.settings.initiative;
          }
        }

        // Only write settings if non-empty
        if (Object.keys(existingSettings).length > 0) {
          agentJson.settings = existingSettings;
        } else {
          delete agentJson.settings;
        }
      }

      await fs.writeFile(agentJsonPath, JSON.stringify(agentJson, null, 2));

      // Update settings.local.json (SDK-level: permissions + model)
      if (body.permissions !== undefined || body.model !== undefined) {
        const settingsPath = path.join(agentDir, '.claude', 'settings.local.json');
        let settings: Record<string, unknown> = {};
        try {
          settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Record<string, unknown>;
        } catch {
          // File doesn't exist, create new
        }

        if (body.permissions !== undefined) settings.permissions = body.permissions;
        if (body.model !== undefined) settings.model = body.model;

        // Ensure .claude directory exists
        await fs.mkdir(path.join(agentDir, '.claude'), { recursive: true });
        await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
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
        agent: {
          id,
          name: reloaded?.config.name ?? body.name ?? agent.config.name,
          path: agentDir,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update agent';
      res.status(500).json({ error: message });
    }
  });

  /**
   * DELETE /api/agents/:id - Delete an agent (soft delete by default)
   * Query params:
   *   - hard=true: Permanently delete instead of moving to .trash/
   *   - force=true: Delete even if there are active sessions
   */
  router.delete('/:id', async (req, res) => {
    const { agentLoader, sessionManager, platformOrchestrator } = getDeps(req);
    const { id } = req.params;
    const hardDelete = req.query.hard === 'true';
    const forceDelete = req.query.force === 'true';

    // Validate reserved IDs
    if (['_example', 'node_modules', '.git'].includes(id)) {
      res.status(400).json({ error: 'Cannot delete reserved agent.' });
      return;
    }

    // Check if agent exists
    const agent = agentLoader.get(id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    try {
      // Get sessions for this agent
      const allSessions = sessionManager.getAllSessions();
      const agentSessions = allSessions.filter((s) => s.agentId === id);

      // Check for active sessions
      const activeSessions = agentSessions.filter((s) => s.state === 'processing');
      if (activeSessions.length > 0 && !forceDelete) {
        res.status(409).json({
          error: 'Agent has active sessions',
          activeSessions: activeSessions.length,
          message: 'Use ?force=true to delete anyway',
        });
        return;
      }

      // Close all sessions for this agent
      for (const session of agentSessions) {
        sessionManager.closeSession(session.platform, id, session.userId, 'user_request');
      }

      // Stop bot adapters for this agent
      if (platformOrchestrator !== undefined) {
        const registry = platformOrchestrator.getRegistry();
        const adapters = registry.getAll().filter((a) => a.agentId === id);
        for (const adapter of adapters) {
          try {
            await adapter.stop();
            await adapter.dispose();
            registry.unregister(adapter.platform, adapter.agentId);
          } catch (error) {
            // Log but continue with deletion
            logger.error({ error, agentId: id }, 'Failed to stop adapter during deletion');
          }
        }
      }

      const agentsDir = path.join(process.cwd(), 'agents');
      const sourceDir = agent.path;

      if (hardDelete) {
        // Permanently delete
        await fs.rm(sourceDir, { recursive: true, force: true });
      } else {
        // Soft delete: move to .trash/
        const trashDir = path.join(agentsDir, '.trash');
        await fs.mkdir(trashDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const trashPath = path.join(trashDir, `${id}-${timestamp}`);

        await fs.rename(sourceDir, trashPath);
      }

      // Remove from AgentLoader cache
      agentLoader.clearCache(id);

      res.json({
        success: true,
        message: hardDelete ? `Agent "${id}" permanently deleted` : `Agent "${id}" moved to trash`,
        closedSessions: agentSessions.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete agent';
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/agents/:id/clone - Clone an agent to a new ID
   */
  router.post('/:id/clone', async (req, res) => {
    const { agentLoader } = getDeps(req);
    const { id } = req.params;
    const { newId, newName, keepMemory } = req.body as {
      newId?: string;
      newName?: string;
      keepMemory?: boolean;
    };

    // Validate newId
    if (!newId) {
      res.status(400).json({ error: 'newId is required' });
      return;
    }

    if (!/^[a-z0-9-]+$/.test(newId)) {
      res.status(400).json({ error: 'Invalid newId. Use only lowercase letters, numbers, and hyphens.' });
      return;
    }

    // Reserved IDs
    if (['_example', 'node_modules', '.git'].includes(newId)) {
      res.status(400).json({ error: 'Reserved agent ID.' });
      return;
    }

    // Check source agent exists
    const sourceAgent = agentLoader.get(id);
    if (!sourceAgent) {
      res.status(404).json({ error: 'Source agent not found' });
      return;
    }

    const agentsDir = path.join(process.cwd(), 'agents');
    const sourceDir = sourceAgent.path;
    const targetDir = path.join(agentsDir, newId);

    try {
      // Check if target already exists
      try {
        await fs.access(targetDir);
        res.status(409).json({ error: `Agent "${newId}" already exists.` });
        return;
      } catch {
        // Target doesn't exist, good to proceed
      }

      // Copy directory recursively
      await fs.cp(sourceDir, targetDir, { recursive: true });

      // Update agent.json
      const agentJsonPath = path.join(targetDir, 'agent.json');
      const agentJson = JSON.parse(await fs.readFile(agentJsonPath, 'utf-8')) as Record<string, unknown>;
      
      // Update name
      agentJson.name = newName ?? `${agentJson.name} (Copy)`;
      
      // Remove telegramBotToken to avoid conflicts
      delete agentJson.telegramBotToken;
      
      await fs.writeFile(agentJsonPath, JSON.stringify(agentJson, null, 2));

      // Clear memory if not keeping it
      if (!keepMemory) {
        const memoryDir = path.join(targetDir, 'memory');
        try {
          const entries = await fs.readdir(memoryDir);
          for (const entry of entries) {
            if (entry !== '.gitkeep') {
              await fs.rm(path.join(memoryDir, entry), { recursive: true, force: true });
            }
          }
        } catch {
          // Memory directory doesn't exist, that's fine
        }

        // Also clear root memory files (USER.md, MEMORY.md)
        const filesToClear = ['USER.md', 'MEMORY.md'];
        for (const file of filesToClear) {
          try {
            await fs.unlink(path.join(targetDir, file));
          } catch {
            // File doesn't exist
          }
        }
      }

      // Load the new agent
      await agentLoader.loadAgent(newId);
      const newAgent = agentLoader.get(newId);

      res.status(201).json({
        success: true,
        agent: {
          id: newId,
          name: newAgent?.config.name ?? agentJson.name,
          path: targetDir,
        },
        message: `Agent "${id}" cloned to "${newId}"`,
      });
    } catch (error) {
      // Cleanup on failure
      try {
        await fs.rm(targetDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      const message = error instanceof Error ? error.message : 'Failed to clone agent';
      res.status(500).json({ error: message });
    }
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

  // ==================== Bot Control API ====================

  /**
   * GET /api/agents/:id/bot/status - Get bot status for an agent
   */
  router.get('/:id/bot/status', (req, res) => {
    const { agentLoader, platformOrchestrator } = getDeps(req);
    const { id } = req.params;

    // Check if agent exists
    const agent = agentLoader.get(id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (platformOrchestrator === undefined) {
      res.status(503).json({ error: 'Platform orchestrator not available' });
      return;
    }

    const status = platformOrchestrator.getBotStatusForAgent(id);
    res.json({ agentId: id, status });
  });

  /**
   * POST /api/agents/:id/bot/start - Start bot for an agent
   */
  router.post('/:id/bot/start', async (req, res) => {
    const { agentLoader, platformOrchestrator } = getDeps(req);
    const { id } = req.params;

    // Check if agent exists
    const agent = agentLoader.get(id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (platformOrchestrator === undefined) {
      res.status(503).json({ error: 'Platform orchestrator not available' });
      return;
    }

    try {
      const platform = (req.body?.platform as 'telegram' | 'discord') ?? 'telegram';
      await platformOrchestrator.startBotForAgent(id, platform);
      const status = platformOrchestrator.getBotStatusForAgent(id, platform);
      res.json({
        success: true,
        message: `Bot started for agent "${id}"`,
        status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start bot';
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/agents/:id/bot/stop - Stop bot for an agent
   */
  router.post('/:id/bot/stop', async (req, res) => {
    const { agentLoader, platformOrchestrator } = getDeps(req);
    const { id } = req.params;

    // Check if agent exists
    const agent = agentLoader.get(id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (platformOrchestrator === undefined) {
      res.status(503).json({ error: 'Platform orchestrator not available' });
      return;
    }

    try {
      const platform = (req.body?.platform as 'telegram' | 'discord') ?? 'telegram';
      await platformOrchestrator.stopBotForAgent(id, platform);
      const status = platformOrchestrator.getBotStatusForAgent(id, platform);
      res.json({
        success: true,
        message: `Bot stopped for agent "${id}"`,
        status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop bot';
      res.status(500).json({ error: message });
    }
  });

  // ==================== Memory API ====================

  /**
   * GET /api/agents/:id/memory - List memory files
   */
  router.get('/:id/memory', async (req, res) => {
    const { agentLoader } = getDeps(req);
    const agent = agentLoader.get(req.params.id);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const coreFilesDef = [
      { name: 'soul.md', path: '.claude/skills/persona/references/soul.md', description: 'AI 人格定義' },
      { name: 'identity.md', path: '.claude/skills/persona/references/identity.md', description: 'AI 身份' },
      { name: 'USER.md', path: 'USER.md', description: '使用者檔案' },
      { name: 'MEMORY.md', path: 'MEMORY.md', description: '長期記憶' },
      { name: 'CLAUDE.md', path: 'CLAUDE.md', description: '啟動協議' },
    ];

    // Get metadata for core files
    const coreFiles: MemoryFile[] = await Promise.all(
      coreFilesDef.map(async (f) => {
        const fullPath = path.join(agent.path, f.path);
        try {
          const stat = await fs.stat(fullPath);
          return { ...f, modified: stat.mtime.toISOString(), size: stat.size };
        } catch {
          return { ...f, modified: null, size: 0 };
        }
      })
    );

    // Scan memory/ directory for daily logs
    const memoryDir = path.join(agent.path, 'memory');
    let dailyLogs: MemoryFile[] = [];
    try {
      const entries = await fs.readdir(memoryDir);
      const logFiles = entries.filter(e => e.endsWith('.md') && e !== '.gitkeep');
      dailyLogs = await Promise.all(
        logFiles.sort().reverse().map(async (e) => {
          const fullPath = path.join(memoryDir, e);
          const stat = await fs.stat(fullPath);
          return {
            name: e,
            path: `memory/${e}`,
            description: '每日日誌',
            modified: stat.mtime.toISOString(),
            size: stat.size,
          };
        })
      );
    } catch {
      // memory directory doesn't exist
    }

    res.json({ coreFiles, dailyLogs });
  });

  /**
   * GET /api/agents/:id/memory/file?path=... - Read a memory file
   * path can include subdirectories like "memory/2026-01-28.md"
   */
  router.get('/:id/memory/file', async (req, res) => {
    const { agentLoader } = getDeps(req);
    const agent = agentLoader.get(req.params.id);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const filePath = req.query.path as string | undefined;
    if (!filePath) {
      res.status(400).json({ error: 'path query parameter required' });
      return;
    }

    const fullPath = path.join(agent.path, filePath);

    // Security check: ensure path is within agent directory
    const resolvedPath = path.resolve(fullPath);
    const agentDir = path.resolve(agent.path);
    if (!resolvedPath.startsWith(agentDir)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const stat = await fs.stat(fullPath);
      res.json({ filename: filePath, content, modified: stat.mtime.toISOString() });
    } catch {
      res.status(404).json({ error: 'File not found' });
    }
  });

  /**
   * PUT /api/agents/:id/memory/file - Update a memory file
   * Request body: { path: string, content: string }
   */
  router.put('/:id/memory/file', async (req, res) => {
    const { agentLoader } = getDeps(req);
    const agent = agentLoader.get(req.params.id);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const { path: filePath, content } = req.body as { path?: string; content?: string };
    if (!filePath) {
      res.status(400).json({ error: 'path required' });
      return;
    }
    if (content === undefined) {
      res.status(400).json({ error: 'content required' });
      return;
    }

    const fullPath = path.join(agent.path, filePath);

    // Security check: ensure path is within agent directory
    const resolvedPath = path.resolve(fullPath);
    const agentDir = path.resolve(agent.path);
    if (!resolvedPath.startsWith(agentDir)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    try {
      // Ensure parent directory exists (for memory/*.md files)
      const parentDir = path.dirname(fullPath);
      await fs.mkdir(parentDir, { recursive: true });

      await fs.writeFile(fullPath, content, 'utf-8');
      const stat = await fs.stat(fullPath);
      res.json({ success: true, modified: stat.mtime.toISOString() });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ==================== Skills API (sub-router) ====================
  router.use('/:id/skills', createAgentSkillsRouter());

  // ==================== Schedules API (sub-router) ====================
  router.use('/:id/schedules', createAgentSchedulesRouter());

  return router;
}
