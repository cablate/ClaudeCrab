/**
 * Schedule Loader
 *
 * Loads and manages schedule specifications from YAML files.
 * Schedule files are stored at: agents/{agentId}/schedules/{taskId}.yaml
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { type ScheduleSpec, validateScheduleSpec, safeValidateScheduleSpec } from './schemas.js';
import { logger } from '../utils/logger.js';

export class ScheduleLoader {
  constructor(private agentsDir: string) {}

  /**
   * Load all schedules from all agents
   */
  async loadAll(): Promise<Map<string, ScheduleSpec[]>> {
    const result = new Map<string, ScheduleSpec[]>();

    try {
      const agentDirs = await fs.readdir(this.agentsDir, { withFileTypes: true });

      for (const dirent of agentDirs) {
        if (!dirent.isDirectory() || dirent.name.startsWith('_')) {
          continue;
        }

        const agentId = dirent.name;
        const schedules = await this.loadForAgent(agentId);
        if (schedules.length > 0) {
          result.set(agentId, schedules);
        }
      }
    } catch (error) {
      logger.error({ error }, '[ScheduleLoader] Failed to load all schedules');
    }

    return result;
  }

  /**
   * Load all schedules for a specific agent
   */
  async loadForAgent(agentId: string): Promise<ScheduleSpec[]> {
    const schedulesDir = path.join(this.agentsDir, agentId, 'schedules');
    const schedules: ScheduleSpec[] = [];

    try {
      const files = await fs.readdir(schedulesDir);

      for (const file of files) {
        if (!file.endsWith('.yaml') && !file.endsWith('.yml')) {
          continue;
        }

        try {
          const filePath = path.join(schedulesDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const parsed = parseYaml(content);
          const spec = validateScheduleSpec(parsed);
          schedules.push(spec);
          logger.debug(`[ScheduleLoader] Loaded schedule: ${spec.id} from ${agentId}`);
        } catch (error) {
          logger.error({ error, file }, '[ScheduleLoader] Failed to load schedule file');
        }
      }
    } catch (error) {
      // Directory doesn't exist, which is fine
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error({ error, agentId }, '[ScheduleLoader] Failed to read schedules dir');
      }
    }

    return schedules;
  }

  /**
   * Load a specific schedule by ID
   */
  async loadById(agentId: string, scheduleId: string): Promise<ScheduleSpec | null> {
    const filePath = path.join(this.agentsDir, agentId, 'schedules', `${scheduleId}.yaml`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = parseYaml(content);
      return validateScheduleSpec(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error({ error, scheduleId }, '[ScheduleLoader] Failed to load schedule');
      }
      return null;
    }
  }

  /**
   * Save a schedule specification
   */
  async save(agentId: string, spec: ScheduleSpec): Promise<void> {
    const schedulesDir = path.join(this.agentsDir, agentId, 'schedules');
    const filePath = path.join(schedulesDir, `${spec.id}.yaml`);

    // Validate spec before saving
    const validation = safeValidateScheduleSpec(spec);
    if (!validation.success) {
      throw new Error(`Invalid schedule spec: ${validation.error.message}`);
    }

    // Ensure schedules directory exists
    await fs.mkdir(schedulesDir, { recursive: true });

    // Write YAML file
    const yamlContent = stringifyYaml(spec, {
      indent: 2,
      lineWidth: 0, // Don't wrap lines
    });

    await fs.writeFile(filePath, yamlContent, 'utf-8');
    logger.info(`[ScheduleLoader] Saved schedule: ${spec.id} for ${agentId}`);
  }

  /**
   * Delete a schedule
   */
  async delete(agentId: string, scheduleId: string): Promise<boolean> {
    const filePath = path.join(this.agentsDir, agentId, 'schedules', `${scheduleId}.yaml`);

    try {
      await fs.unlink(filePath);
      logger.info(`[ScheduleLoader] Deleted schedule: ${scheduleId} from ${agentId}`);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error({ error, scheduleId }, '[ScheduleLoader] Failed to delete schedule');
      }
      return false;
    }
  }

  /**
   * Check if a schedule exists
   */
  async exists(agentId: string, scheduleId: string): Promise<boolean> {
    const filePath = path.join(this.agentsDir, agentId, 'schedules', `${scheduleId}.yaml`);

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all schedule IDs for an agent
   */
  async listIds(agentId: string): Promise<string[]> {
    const schedulesDir = path.join(this.agentsDir, agentId, 'schedules');
    const ids: string[] = [];

    try {
      const files = await fs.readdir(schedulesDir);
      for (const file of files) {
        if (file.endsWith('.yaml') || file.endsWith('.yml')) {
          ids.push(file.replace(/\.ya?ml$/, ''));
        }
      }
    } catch {
      // Directory doesn't exist
    }

    return ids;
  }
}
