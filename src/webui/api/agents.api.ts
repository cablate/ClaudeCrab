import { Router } from 'express';
import type { Request } from 'express';
import type { WebUIRequest, WebUIDependencies, CreateAgentRequest, UpdateAgentRequest, MemoryFile } from '../types.js';
import fs from 'node:fs/promises';
import path from 'node:path';

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

      // Update agent.json if any field changed
      if (body.name !== undefined || body.description !== undefined || body.model !== undefined || body.telegramBotToken !== undefined) {
        const agentJsonPath = path.join(agentDir, 'agent.json');
        const agentJson = JSON.parse(await fs.readFile(agentJsonPath, 'utf-8')) as Record<string, unknown>;

        if (body.name !== undefined) agentJson.name = body.name;
        if (body.description !== undefined) agentJson.description = body.description;
        if (body.model !== undefined) agentJson.model = body.model;
        if (body.telegramBotToken !== undefined) {
          if (body.telegramBotToken === null) {
            delete agentJson.telegramBotToken;
          } else {
            agentJson.telegramBotToken = body.telegramBotToken;
          }
        }

        await fs.writeFile(agentJsonPath, JSON.stringify(agentJson, null, 2));
      }

      // Update settings.local.json if permissions or model changed
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
      { name: 'SOUL.md', path: 'SOUL.md', description: 'AI 人格定義' },
      { name: 'USER.md', path: 'USER.md', description: '使用者檔案' },
      { name: 'IDENTITY.md', path: 'IDENTITY.md', description: 'AI 身份' },
      { name: 'MEMORY.md', path: 'MEMORY.md', description: '長期記憶' },
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

  return router;
}
