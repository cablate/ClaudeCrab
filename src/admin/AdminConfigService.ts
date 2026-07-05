import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AgentConfigSchema } from '../types/agent.js';

type FieldType = 'string' | 'number' | 'boolean' | 'model' | 'permissionMode';

interface FieldDefinition {
  key: string;
  label: string;
  type: FieldType;
  secret?: boolean;
  restartRequired?: boolean;
}

export interface AdminFieldSnapshot {
  key: string;
  label: string;
  value: string | number | boolean | null;
  set: boolean;
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

const GLOBAL_FIELDS: FieldDefinition[] = [
  { key: 'DISCORD_ENABLED', label: 'Discord enabled', type: 'boolean', restartRequired: true },
  { key: 'DISCORD_MAIN_BOT_TOKEN', label: 'Main bot token', type: 'string', secret: true, restartRequired: true },
  { key: 'DISCORD_MAIN_BOT_CLIENT_ID', label: 'Main bot client ID', type: 'string', restartRequired: true },
  { key: 'DISCORD_GUILD_ID', label: 'Discord guild ID', type: 'string', restartRequired: true },
  { key: 'DISCORD_OWNER_USER_ID', label: 'Operator user ID', type: 'string' },
  { key: 'AGENTS_DIR', label: 'Agents directory', type: 'string', restartRequired: true },
  { key: 'ENABLE_PERSISTENCE', label: 'Persistence enabled', type: 'boolean', restartRequired: true },
  { key: 'DB_PATH', label: 'Database path', type: 'string', restartRequired: true },
  { key: 'ANTHROPIC_API_KEY', label: 'Global Anthropic API key', type: 'string', secret: true, restartRequired: true },
  { key: 'ANTHROPIC_BASE_URL', label: 'Global provider base URL', type: 'string', restartRequired: true },
  { key: 'SCHEDULE_ENABLED', label: 'Schedule enabled', type: 'boolean', restartRequired: true },
  { key: 'SCHEDULE_CATCHUP_ENABLED', label: 'Schedule catch-up enabled', type: 'boolean', restartRequired: true },
  { key: 'SESSION_IDLE_CLOSE_MS', label: 'Session idle close ms', type: 'number', restartRequired: true },
  { key: 'SESSION_EPHEMERAL', label: 'Ephemeral SDK sessions', type: 'boolean', restartRequired: true },
  { key: 'CACHE_KEEPALIVE_ENABLED', label: 'Cache keepalive enabled', type: 'boolean', restartRequired: true },
  { key: 'SESSION_GUARD_ENABLED', label: 'Session guard enabled', type: 'boolean', restartRequired: true },
  { key: 'ALLOWED_USERS', label: 'Allowed Discord users', type: 'string' },
  { key: 'ADMIN_CONSOLE_ENABLED', label: 'Admin console enabled', type: 'boolean', restartRequired: true },
  { key: 'ADMIN_CONSOLE_HOST', label: 'Admin console host', type: 'string', restartRequired: true },
  { key: 'ADMIN_CONSOLE_PORT', label: 'Admin console port', type: 'number', restartRequired: true },
  { key: 'ADMIN_CONSOLE_TOKEN', label: 'Admin console token', type: 'string', secret: true, restartRequired: true },
  { key: 'CLAUDECAB_LOCAL_CONFIG_PATH', label: 'Local config path', type: 'string', restartRequired: true },
];

const AGENT_FIELDS: FieldDefinition[] = [
  { key: 'name', label: 'Name', type: 'string' },
  { key: 'description', label: 'Description', type: 'string' },
  { key: 'model', label: 'Default model', type: 'model' },
  { key: 'discordBotToken', label: 'Agent bot token', type: 'string', secret: true, restartRequired: true },
  { key: 'discordChannelId', label: 'Discord channel ID', type: 'string', restartRequired: true },
];

const AGENT_SETTINGS_FIELDS: FieldDefinition[] = [
  { key: 'permissionMode', label: 'Permission mode', type: 'permissionMode' },
  { key: 'maxTurns', label: 'Max turns', type: 'number' },
  { key: 'maxBudgetUsd', label: 'Max budget USD', type: 'number' },
];

const CLAUDE_SETTINGS_FIELDS: FieldDefinition[] = [
  { key: 'model', label: 'SDK model', type: 'model' },
];

const PROVIDER_ENV_FIELDS: FieldDefinition[] = [
  { key: 'ANTHROPIC_API_KEY', label: 'Agent API key', type: 'string', secret: true },
  { key: 'ANTHROPIC_AUTH_TOKEN', label: 'Agent auth token', type: 'string', secret: true },
  { key: 'ANTHROPIC_BASE_URL', label: 'Agent provider base URL', type: 'string' },
];

const MODEL_VALUES = new Set(['sonnet', 'opus', 'haiku']);
const PERMISSION_MODE_VALUES = new Set(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']);

export class AdminConfigService {
  private readonly cwd: string;
  private readonly agentsDir: string;
  private readonly localConfigPath: string;

  constructor(options: { cwd: string; agentsDir: string; localConfigPath: string }) {
    this.cwd = options.cwd;
    this.agentsDir = path.resolve(options.cwd, options.agentsDir);
    this.localConfigPath = options.localConfigPath;
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
      const normalized = normalizeValue(value, field);
      current[key] = normalized;
      updated.push(key);
      restartRequired ||= field.restartRequired === true;
    }

    await fs.mkdir(path.dirname(this.localConfigPath), { recursive: true });
    await fs.writeFile(this.localConfigPath, `${JSON.stringify(current, null, 2)}\n`, 'utf-8');
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

    if (update.agent !== undefined) {
      const values = normalizeUpdateRecord(update.agent, AGENT_FIELDS);
      for (const [key, value] of Object.entries(values)) {
        const field = getField(AGENT_FIELDS, key);
        agentConfig[key] = normalizeValue(value, field);
        updated.push(`agent.${key}`);
        restartRequired ||= field.restartRequired === true;
      }
    }

    if (update.settings !== undefined) {
      const values = normalizeUpdateRecord(update.settings, [...AGENT_SETTINGS_FIELDS, ...CLAUDE_SETTINGS_FIELDS]);
      for (const [key, value] of Object.entries(values)) {
        const field = getField([...AGENT_SETTINGS_FIELDS, ...CLAUDE_SETTINGS_FIELDS], key);
        if (key === 'model') {
          settings[key] = normalizeValue(value, field);
          sessionCloseRecommended = true;
          updated.push(`settings.${key}`);
        } else {
          const currentSettings = ensureRecord(agentConfig, 'settings');
          currentSettings[key] = normalizeValue(value, field);
          updated.push(`agent.settings.${key}`);
        }
      }
    }

    if (update.providerEnv !== undefined) {
      const values = normalizeUpdateRecord(update.providerEnv, PROVIDER_ENV_FIELDS);
      const env = ensureRecord(settings, 'env');
      for (const [key, value] of Object.entries(values)) {
        const field = getField(PROVIDER_ENV_FIELDS, key);
        env[key] = normalizeValue(value, field);
        updated.push(`settings.env.${key}`);
        sessionCloseRecommended = true;
      }
    }

    const validation = AgentConfigSchema.safeParse(agentConfig);
    if (!validation.success) {
      const reason = validation.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      throw new Error(`agent.json validation failed: ${reason}`);
    }

    await fs.writeFile(agentPath, `${JSON.stringify(agentConfig, null, 2)}\n`, 'utf-8');
    if (Object.keys(settings).length > 0) {
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
    const agentSettings = toRecord(agentConfig.settings);
    const providerEnv = toRecord(settings.env);

    return {
      id: agentId,
      name: typeof agentConfig.name === 'string' ? agentConfig.name : null,
      agent: AGENT_FIELDS.map((field) => snapshotField(field, agentConfig[field.key] ?? null)),
      settings: [
        ...AGENT_SETTINGS_FIELDS.map((field) => snapshotField(field, agentSettings[field.key] ?? null)),
        ...CLAUDE_SETTINGS_FIELDS.map((field) => snapshotField(field, settings[field.key] ?? null)),
      ],
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
    value: field.secret === true ? (set ? '********' : null) : normalizeSnapshotValue(rawValue),
    set,
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
  if (field.type === 'model' && text !== '' && !MODEL_VALUES.has(text)) {
    throw new Error(`${field.key} must be one of: ${[...MODEL_VALUES].join(', ')}.`);
  }
  if (field.type === 'permissionMode' && text !== '' && !PERMISSION_MODE_VALUES.has(text)) {
    throw new Error(`${field.key} must be one of: ${[...PERMISSION_MODE_VALUES].join(', ')}.`);
  }
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
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8')) as unknown;
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
