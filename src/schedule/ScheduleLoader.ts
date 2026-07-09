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
import { EventType } from '../utils/events.js';

function scheduleFilename(id: string): string {
  return id.includes('/') ? id.split('/').pop() ?? '' : id;
}

export class ScheduleLoader {
  constructor(private agentsDir: string) {}

  getAgentsDir(): string {
    return this.agentsDir;
  }

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
      logger.error({ event_type: EventType.SCHEDULE_ERROR, err: error }, '[ScheduleLoader] Failed to load all schedules');
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

          // Canonical ID = agentId/filename (without extension)
          // This ensures uniqueness across agents with same filename
          const filenameId = file.replace(/\.ya?ml$/, '');
          const canonicalId = `${agentId}/${filenameId}`;
          if (spec.id !== filenameId) {
            logger.warn(
              { event_type: EventType.SCHEDULE_LOADED },
              `[ScheduleLoader] Schedule ID mismatch: file="${file}" has id="${spec.id}", using filename "${filenameId}" as canonical ID`
            );
          }
          spec.id = canonicalId;

          schedules.push(spec);
          logger.debug(`[ScheduleLoader] Loaded schedule: ${spec.id} from ${agentId}`);
        } catch (error) {
          logger.error({ event_type: EventType.SCHEDULE_ERROR, err: error, file }, '[ScheduleLoader] Failed to load schedule file');
        }
      }
    } catch (error) {
      // Directory doesn't exist, which is fine
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error({ event_type: EventType.SCHEDULE_ERROR, err: error, agentId }, '[ScheduleLoader] Failed to read schedules dir');
      }
    }

    return schedules;
  }

  /**
   * Save a schedule specification
   */
  async save(agentId: string, spec: ScheduleSpec): Promise<void> {
    const schedulesDir = path.join(this.agentsDir, agentId, 'schedules');
    // Extract filename from spec.id (may be "agentId/filename" or just "filename")
    const filename = scheduleFilename(spec.id);
    const filePath = path.join(schedulesDir, `${filename}.yaml`);

    // Validate spec before saving
    const validation = safeValidateScheduleSpec(spec);
    if (!validation.success) {
      throw new Error(`Invalid schedule spec: ${validation.error.message}`);
    }

    // Ensure schedules directory exists
    await fs.mkdir(schedulesDir, { recursive: true });

    // Write YAML file - save with filename as id, not the full canonical id
    const specToSave = { ...spec, id: filename };
    const yamlContent = stringifyYaml(specToSave, {
      indent: 2,
      lineWidth: 0, // Don't wrap lines
    });

    await fs.writeFile(filePath, yamlContent, 'utf-8');
    logger.info({ event_type: EventType.SCHEDULE_LOADED }, `[ScheduleLoader] Saved schedule: ${spec.id} for ${agentId}`);
  }
}
