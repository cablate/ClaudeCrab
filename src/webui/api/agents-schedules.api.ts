import { Router } from 'express';
import type { Request, Response } from 'express';
import type { WebUIRequest, WebUIDependencies } from '../types.js';

/** Params inherited from parent router via mergeParams */
interface AgentParams {
  id: string;
  [key: string]: string;
}

/** Params for schedule-specific routes */
interface ScheduleParams extends AgentParams {
  scheduleId: string;
}
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { validateScheduleSpec } from '../../schedule/schemas.js';


/**
 * Helper to get dependencies from request
 */
function getDeps(req: Request): WebUIDependencies {
  return (req as WebUIRequest).dependencies;
}

/**
 * Helper to extract filename from canonical schedule ID (e.g., "admin/daily-digest" -> "daily-digest")
 */
function extractScheduleFilename(scheduleId: string): string {
  return scheduleId.includes('/') ? scheduleId.split('/').pop()! : scheduleId;
}

/**
 * Create agent schedules sub-router
 * Mounted at /api/agents/:id/schedules
 */
export function createAgentSchedulesRouter(): Router {
  const router = Router({ mergeParams: true });

  /**
   * GET / - List schedules for an agent
   */
  router.get('/', async (req: Request<AgentParams>, res: Response) => {
    const { agentLoader, scheduleManager } = getDeps(req);
    const agent = agentLoader.get(req.params.id);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (!scheduleManager) {
      res.status(503).json({ error: 'Schedule system not enabled' });
      return;
    }

    try {
      const schedules = await scheduleManager.getSchedulesForAgent(agent.id);
      res.json({ schedules });
    } catch (error) {
      res.status(500).json({ error: 'Failed to load schedules', details: String(error) });
    }
  });

  /**
   * POST / - Create a new schedule
   */
  router.post('/', async (req: Request<AgentParams>, res: Response) => {
    const { agentLoader, scheduleManager } = getDeps(req);
    const agent = agentLoader.get(req.params.id);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (!scheduleManager) {
      res.status(503).json({ error: 'Schedule system not enabled' });
      return;
    }

    const body = req.body as {
      id?: string;
      name?: string;
      description?: string;
      trigger?: {
        type?: string;
        cron?: string;
        at?: string;
        interval?: number;
        timezone?: string;
      };
      action?: {
        type?: string;
        chatId?: string;
        prompt?: string;
      };
      enabled?: boolean;
    };

    // Validate required fields
    if (!body.id) {
      res.status(400).json({ error: 'id is required' });
      return;
    }
    if (!body.name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!body.trigger) {
      res.status(400).json({ error: 'trigger is required' });
      return;
    }

    // Validate trigger based on type
    const triggerType = body.trigger.type || 'cron';
    if (triggerType === 'cron' && !body.trigger.cron) {
      res.status(400).json({ error: 'trigger.cron is required for cron type' });
      return;
    }
    if (triggerType === 'once' && !body.trigger.at) {
      res.status(400).json({ error: 'trigger.at is required for once type' });
      return;
    }
    if (triggerType === 'interval' && !body.trigger.interval) {
      res.status(400).json({ error: 'trigger.interval is required for interval type' });
      return;
    }

    if (!body.action?.chatId) {
      res.status(400).json({ error: 'action.chatId is required' });
      return;
    }
    if (!body.action?.prompt) {
      res.status(400).json({ error: 'action.prompt is required' });
      return;
    }

    // Validate schedule ID format
    if (!/^[a-z0-9-]+$/.test(body.id)) {
      res.status(400).json({ error: 'Invalid schedule ID. Use only lowercase letters, numbers, and hyphens.' });
      return;
    }

    try {
      // Check if schedule already exists
      const schedulePath = path.join(agent.path, 'schedules', `${body.id}.yaml`);
      try {
        await fs.access(schedulePath);
        res.status(409).json({ error: `Schedule "${body.id}" already exists` });
        return;
      } catch {
        // Doesn't exist, good to proceed
      }

      // Build trigger config based on type
      const triggerConfig: Record<string, unknown> = {
        type: triggerType,
        timezone: body.trigger.timezone ?? 'Asia/Taipei',
      };
      if (triggerType === 'cron') {
        triggerConfig.cron = body.trigger.cron;
      } else if (triggerType === 'once') {
        triggerConfig.at = body.trigger.at;
      } else if (triggerType === 'interval') {
        triggerConfig.interval = body.trigger.interval;
      }

      // Build schedule spec
      const scheduleSpec = {
        id: body.id,
        name: body.name,
        description: body.description ?? '',
        trigger: triggerConfig,
        action: {
          type: body.action.type ?? 'send_message',
          chatId: body.action.chatId,
          prompt: body.action.prompt,
        },
        enabled: body.enabled ?? true,
      };

      // Validate the spec
      validateScheduleSpec(scheduleSpec);

      // Convert to YAML
      const yamlContent = stringifyYaml(scheduleSpec);

      // Ensure schedules directory exists
      await fs.mkdir(path.join(agent.path, 'schedules'), { recursive: true });

      // Write the file
      await fs.writeFile(schedulePath, yamlContent, 'utf-8');

      // Load the schedule into the manager
      await scheduleManager.reloadSchedule(agent.id, body.id);

      res.status(201).json({
        success: true,
        message: `Schedule "${body.id}" created`,
        schedule: scheduleSpec,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create schedule';
      res.status(500).json({ error: message });
    }
  });

  /**
   * GET /:scheduleId - Get schedule YAML content
   */
  router.get('/:scheduleId', async (req: Request<ScheduleParams>, res: Response) => {
    const { agentLoader } = getDeps(req);
    const agent = agentLoader.get(req.params.id);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const scheduleId = req.params.scheduleId;
    const filename = extractScheduleFilename(scheduleId);
    const schedulePath = path.join(agent.path, 'schedules', `${filename}.yaml`);

    try {
      const content = await fs.readFile(schedulePath, 'utf-8');
      const stat = await fs.stat(schedulePath);
      res.json({
        id: scheduleId,
        content,
        modified: stat.mtime.toISOString(),
      });
    } catch {
      res.status(404).json({ error: 'Schedule not found' });
    }
  });

  /**
   * PUT /:scheduleId - Update schedule YAML
   */
  router.put('/:scheduleId', async (req: Request<ScheduleParams>, res: Response) => {
    const { agentLoader, scheduleManager } = getDeps(req);
    const agent = agentLoader.get(req.params.id);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (!scheduleManager) {
      res.status(503).json({ error: 'Schedule system not enabled' });
      return;
    }

    const scheduleId = req.params.scheduleId;
    const { content } = req.body as { content: string };

    if (!content || typeof content !== 'string') {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    // Validate YAML structure
    try {
      const parsed = parseYaml(content);
      validateScheduleSpec(parsed);
    } catch (error) {
      res.status(400).json({ error: 'Invalid YAML or schema', details: String(error) });
      return;
    }

    const filename = extractScheduleFilename(scheduleId);
    const schedulePath = path.join(agent.path, 'schedules', `${filename}.yaml`);

    try {
      await fs.writeFile(schedulePath, content, 'utf-8');
      // Reload the schedule in the scheduler
      await scheduleManager.reloadSchedule(agent.id, scheduleId);
      res.json({ success: true, message: 'Schedule updated' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to save schedule', details: String(error) });
    }
  });

  /**
   * DELETE /:scheduleId - Delete a schedule
   */
  router.delete('/:scheduleId', async (req: Request<ScheduleParams>, res: Response) => {
    const { agentLoader, scheduleManager } = getDeps(req);
    const agent = agentLoader.get(req.params.id);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (!scheduleManager) {
      res.status(503).json({ error: 'Schedule system not enabled' });
      return;
    }

    const scheduleId = req.params.scheduleId;

    try {
      await scheduleManager.deleteSchedule(scheduleId);
      res.json({ success: true, message: 'Schedule deleted' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete schedule', details: String(error) });
    }
  });

  /**
   * POST /:scheduleId/pause - Pause a schedule
   */
  router.post('/:scheduleId/pause', async (req: Request<ScheduleParams>, res: Response) => {
    const { agentLoader, scheduleManager } = getDeps(req);
    const agent = agentLoader.get(req.params.id);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (!scheduleManager) {
      res.status(503).json({ error: 'Schedule system not enabled' });
      return;
    }

    const scheduleId = req.params.scheduleId;

    try {
      await scheduleManager.pauseSchedule(scheduleId);
      res.json({ success: true, message: 'Schedule paused' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to pause schedule', details: String(error) });
    }
  });

  /**
   * POST /:scheduleId/resume - Resume a schedule
   */
  router.post('/:scheduleId/resume', async (req: Request<ScheduleParams>, res: Response) => {
    const { agentLoader, scheduleManager } = getDeps(req);
    const agent = agentLoader.get(req.params.id);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (!scheduleManager) {
      res.status(503).json({ error: 'Schedule system not enabled' });
      return;
    }

    const scheduleId = req.params.scheduleId;

    try {
      await scheduleManager.resumeSchedule(scheduleId);
      res.json({ success: true, message: 'Schedule resumed' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to resume schedule', details: String(error) });
    }
  });

  /**
   * POST /:scheduleId/run - Run a schedule immediately
   */
  router.post('/:scheduleId/run', async (req: Request<ScheduleParams>, res: Response) => {
    const { agentLoader, scheduleManager } = getDeps(req);
    const agent = agentLoader.get(req.params.id);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (!scheduleManager) {
      res.status(503).json({ error: 'Schedule system not enabled' });
      return;
    }

    const scheduleId = req.params.scheduleId;

    try {
      // runNow returns immediately, execution happens in background
      await scheduleManager.runNow(scheduleId);
      res.json({ success: true, message: 'Schedule execution started' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to run schedule', details: String(error) });
    }
  });

  /**
   * GET /:scheduleId/history - Get execution history
   */
  router.get('/:scheduleId/history', async (req: Request<ScheduleParams>, res: Response) => {
    const { agentLoader, scheduleManager } = getDeps(req);
    const agent = agentLoader.get(req.params.id);

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (!scheduleManager) {
      res.status(503).json({ error: 'Schedule system not enabled' });
      return;
    }

    const scheduleId = req.params.scheduleId;
    const limit = parseInt(req.query.limit as string) || 20;

    try {
      const history = scheduleManager.getExecutionHistory(scheduleId, limit);
      res.json({ history });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get history', details: String(error) });
    }
  });

  return router;
}
