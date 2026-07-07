import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AgentConfigSchema } from '../types/agent.js';

import type { FieldDefinition, FieldType } from './AdminConfigFields.js';
import {
  AGENT_FIELDS,
  CLAUDE_SETTINGS_FIELDS,
  GLOBAL_FIELDS,
  PROVIDER_ENV_FIELDS,
} from './AdminConfigFields.js';

export type { FieldType } from './AdminConfigFields.js';

export interface AdminFieldSnapshot {
  key: string;
  label: string;
  type: FieldType;
  group: string;
  help: string;
  placeholder: string;
  value: string | number | boolean | null;
  set: boolean;
  required: boolean;
  secret: boolean;
  restartRequired: boolean;
}

export interface AdminConfigSnapshot {
  global: AdminFieldSnapshot[];
  agents: AdminAgentSnapshot[];
}

export interface AdminAgentSnapshot {
  id: string;
  name: string | null;
  agent: AdminFieldSnapshot[];
  settings: AdminFieldSnapshot[];
  providerEnv: AdminFieldSnapshot[];
}

export interface AdminGlobalUpdate {
  values: Record<string, string | number | boolean | null>;
}

export interface AdminAgentUpdate {
  agent?: Record<string, string | number | boolean | null>;
  settings?: Record<string, string | number | boolean | null>;
  providerEnv?: Record<string, string | number | boolean | null>;
}

export interface AdminUpdateResult {
  updated: string[];
  restartRequired: boolean;
  sessionCloseRecommended: boolean;
}

export class AdminConfigService {
  private readonly cwd: string;
  private readonly agentsDir: string;
  private readonly localConfigPath: string;

  constructor(options: { cwd: string; agentsDir: string; localConfigPath: string }) {
    this.cwd = path.resolve(options.cwd);
    this.agentsDir = path.resolve(this.cwd, options.agentsDir);
    this.localConfigPath = path.isAbsolute(options.localConfigPath)
      ? path.normalize(options.localConfigPath)
      : path.resolve(this.cwd, options.localConfigPath);
  }

  async getSnapshot(): Promise<AdminConfigSnapshot> {
    const localConfig = await readOptionalJsonRecord(this.localConfigPath);
    const agentIds = await this.listAgentIds();
    const agents: AdminAgentSnapshot[] = [];
    for (const agentId of agentIds) {
      agents.push(await this.getAgentSnapshot(agentId));
    }

    return {
      global: GLOBAL_FIELDS.map((field) => snapshotField(field, localConfig[field.key] ?? null)),
      agents,
    };
  }

  async updateGlobal(update: AdminGlobalUpdate): Promise<AdminUpdateResult> {
    const values = normalizeUpdateRecord(update.values, GLOBAL_FIELDS);
    const current = await readOptionalJsonRecord(this.localConfigPath);
    const updated: string[] = [];
    let restartRequired = false;

    for (const [key, value] of Object.entries(values)) {
      const field = getField(GLOBAL_FIELDS, key);
      if (value === null || value === '') {
        if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
        delete current[key];
        updated.push(key);
        restartRequired ||= field.restartRequired === true;
        continue;
      }

      const normalized = normalizeValue(value, field);
      if (current[key] === normalized) continue;
      current[key] = normalized;
      updated.push(key);
      restartRequired ||= field.restartRequired === true;
    }

    if (updated.length > 0) {
      await fs.mkdir(path.dirname(this.localConfigPath), { recursive: true });
      await fs.writeFile(this.localConfigPath, `${JSON.stringify(current, null, 2)}\n`, 'utf-8');
    }
    return { updated, restartRequired, sessionCloseRecommended: false };
  }

  async updateAgent(agentId: string, update: AdminAgentUpdate): Promise<AdminUpdateResult> {
    const agentDir = this.resolveAgentDir(agentId);
    const agentPath = path.join(agentDir, 'agent.json');
    const settingsPath = path.join(agentDir, '.claude', 'settings.local.json');
    const agentConfig = await readJsonRecord(agentPath);
    const settings = await readOptionalJsonRecord(settingsPath);
    const updated: string[] = [];
    let restartRequired = false;
    let sessionCloseRecommended = false;
    let settingsTouched = false;

    if (update.agent !== undefined) {
      const values = normalizeUpdateRecord(update.agent, AGENT_FIELDS);
      for (const [key, value] of Object.entries(values)) {
        const field = getField(AGENT_FIELDS, key);
        if ((value === null || value === '') && field.required !== true) {
          if (!Object.prototype.hasOwnProperty.call(agentConfig, key)) continue;
          delete agentConfig[key];
          updated.push(`agent.${key}`);
          restartRequired ||= field.restartRequired === true;
          continue;
        }
        agentConfig[key] = normalizeValue(value, field);
        updated.push(`agent.${key}`);
        restartRequired ||= field.restartRequired === true;
      }
    }

    if (update.settings !== undefined) {
      const values = normalizeUpdateRecord(update.settings, CLAUDE_SETTINGS_FIELDS);
      for (const [key, value] of Object.entries(values)) {
        const field = getField(CLAUDE_SETTINGS_FIELDS, key);
        if (value === null || value === '') {
          if (!Object.prototype.hasOwnProperty.call(settings, key)) continue;
          delete settings[key];
          settingsTouched = true;
          sessionCloseRecommended = true;
          updated.push(`settings.${key}`);
          continue;
        }
        settings[key] = normalizeValue(value, field);
        settingsTouched = true;
        sessionCloseRecommended = true;
        updated.push(`settings.${key}`);
      }
    }

    if (update.providerEnv !== undefined) {
      const values = normalizeUpdateRecord(update.providerEnv, PROVIDER_ENV_FIELDS);
      const env = ensureRecord(settings, 'env');
      for (const [key, value] of Object.entries(values)) {
        const field = getField(PROVIDER_ENV_FIELDS, key);
        if (value === null || value === '') {
          if (!Object.prototype.hasOwnProperty.call(env, key)) continue;
          delete env[key];
          settingsTouched = true;
          updated.push(`settings.env.${key}`);
          sessionCloseRecommended = true;
          continue;
        }
        env[key] = normalizeValue(value, field);
        settingsTouched = true;
        updated.push(`settings.env.${key}`);
        sessionCloseRecommended = true;
      }
      if (Object.keys(env).length === 0) {
        delete settings.env;
      }
    }

    const validation = AgentConfigSchema.safeParse(agentConfig);
    if (!validation.success) {
      const reason = validation.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      throw new Error(`agent.json validation failed: ${reason}`);
    }

    await fs.writeFile(agentPath, `${JSON.stringify(agentConfig, null, 2)}\n`, 'utf-8');
    if (settingsTouched || Object.keys(settings).length > 0) {
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
    }

    return { updated, restartRequired, sessionCloseRecommended };
  }

  private async listAgentIds(): Promise<string[]> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(this.agentsDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const ids: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      try {
        await fs.access(path.join(this.agentsDir, entry.name, 'agent.json'));
        ids.push(entry.name);
      } catch {
        // Ignore folders without agent.json.
      }
    }
    return ids.sort((left, right) => left.localeCompare(right));
  }

  private async getAgentSnapshot(agentId: string): Promise<AdminAgentSnapshot> {
    const agentDir = this.resolveAgentDir(agentId);
    const agentConfig = await readJsonRecord(path.join(agentDir, 'agent.json'));
    const settings = await readOptionalJsonRecord(path.join(agentDir, '.claude', 'settings.local.json'));
    const providerEnv = toRecord(settings.env);

    return {
      id: agentId,
      name: typeof agentConfig.name === 'string' ? agentConfig.name : null,
      agent: AGENT_FIELDS.map((field) => snapshotField(field, agentConfig[field.key] ?? null)),
      settings: CLAUDE_SETTINGS_FIELDS.map((field) => snapshotField(field, settings[field.key] ?? null)),
      providerEnv: PROVIDER_ENV_FIELDS.map((field) => snapshotField(field, providerEnv[field.key] ?? null)),
    };
  }

  private resolveAgentDir(agentId: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(agentId)) {
      throw new Error('Invalid agent id.');
    }
    const resolved = path.resolve(this.agentsDir, agentId);
    const relative = path.relative(this.agentsDir, resolved);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Agent path escapes AGENTS_DIR.');
    }
    return resolved;
  }
}

function snapshotField(field: FieldDefinition, rawValue: unknown): AdminFieldSnapshot {
  const set = rawValue !== null && rawValue !== undefined && rawValue !== '';
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    group: field.group,
    help: field.help,
    placeholder: field.placeholder ?? '',
    value: field.secret === true ? (set ? '********' : null) : normalizeSnapshotValue(rawValue),
    set,
    required: field.required === true,
    secret: field.secret === true,
    restartRequired: field.restartRequired === true,
  };
}

function normalizeSnapshotValue(value: unknown): string | number | boolean | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
}

function normalizeUpdateRecord(
  input: Record<string, string | number | boolean | null>,
  fields: FieldDefinition[],
): Record<string, string | number | boolean | null> {
  const allowed = new Set(fields.map((field) => field.key));
  const normalized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) throw new Error(`Field is not editable: ${key}`);
    normalized[key] = value;
  }
  return normalized;
}

function normalizeValue(value: string | number | boolean | null, field: FieldDefinition): string | number | boolean {
  if (value === null) return '';
  if (field.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`${field.key} must be true or false.`);
  }
  if (field.type === 'number') {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${field.key} must be numeric.`);
    return parsed;
  }
  const text = String(value);
  return text;
}

function getField(fields: FieldDefinition[], key: string): FieldDefinition {
  const field = fields.find((candidate) => candidate.key === key);
  if (field === undefined) throw new Error(`Field is not editable: ${key}`);
  return field;
}

function ensureRecord(target: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = target[key];
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  target[key] = next;
  return next;
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(stripBom(await fs.readFile(filePath, 'utf-8'))) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${filePath} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

async function readOptionalJsonRecord(filePath: string): Promise<Record<string, unknown>> {
  try {
    return await readJsonRecord(filePath);
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return {};
    throw error;
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}
