import 'dotenv/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import cron from 'node-cron';
import { REST, Routes } from 'discord.js';
import { parse as parseYaml } from 'yaml';
import { loadAppConfig } from '../src/config.js';
import { AgentLoader } from '../src/core/orchestrator/AgentLoader.js';
import { SDKSessionManager } from '../src/core/session/SDKSessionManager.js';
import { DatabaseManager } from '../src/persistence/DatabaseManager.js';
import { SessionRepository } from '../src/persistence/SessionRepository.js';
import { ScheduleExecutor } from '../src/schedule/ScheduleExecutor.js';
import { ScheduleLoader } from '../src/schedule/ScheduleLoader.js';
import { ScheduleNotifier } from '../src/schedule/ScheduleNotifier.js';
import {
  resolveScheduleTargets,
  resolveThreadChannelId,
  resolveThreadTitle,
} from '../src/schedule/ScheduleOutput.js';
import { safeValidateScheduleSpec, type ScheduleSpec } from '../src/schedule/schemas.js';
import type { BaseAdapter } from '../src/adapters/BaseAdapter.js';

type CheckLevel = 'ok' | 'warn' | 'error';

interface ScheduleCheck {
  level: CheckLevel;
  file: string;
  scheduleId: string;
  message: string;
}

interface LoadedScheduleFile {
  agentId: string;
  filePath: string;
  canonicalId: string;
  spec: ScheduleSpec | null;
  checks: ScheduleCheck[];
}

const command = process.argv[2] ?? 'help';
const targetScheduleId = process.argv[3];
const channelOverride = readArgValue('--channel');
const strictMode = process.argv.includes('--strict');

async function main(): Promise<void> {
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  const config = loadAppConfig();

  if (command === 'list') {
    const files = await loadScheduleFiles(config.agentsDir);
    printScheduleList(files);
    throwIfErrors(files);
    return;
  }

  if (command === 'validate') {
    const files = await loadScheduleFiles(config.agentsDir);
    printValidation(files);
    throwIfErrors(files);
    throwIfStrictWarnings(files);
    return;
  }

  if (command === 'check') {
    if (!targetScheduleId) {
      throw new Error('Missing schedule yaml path. Usage: npm run schedule:check -- <path-to-yaml> [--strict]');
    }
    const file = await loadScheduleFile(config.agentsDir, path.resolve(targetScheduleId));
    printValidation([file]);
    throwIfErrors([file]);
    throwIfStrictWarnings([file]);
    return;
  }

  if (command === 'run') {
    if (!targetScheduleId) {
      throw new Error('Missing schedule id. Usage: npm run schedule:run -- <agentId/scheduleId>');
    }
    await runSchedule(config, targetScheduleId);
    return;
  }

  if (command === 'trigger') {
    if (!targetScheduleId) {
      throw new Error('Missing schedule id. Usage: npm run schedule:trigger -- <agentId/scheduleId>');
    }
    await triggerScheduleWithDiscordDelivery(config, targetScheduleId);
    return;
  }

  if (command === 'discord-test') {
    if (!targetScheduleId) {
      throw new Error('Missing schedule id. Usage: npm run schedule:discord-test -- <agentId/scheduleId>');
    }
    await testDiscordThreadDelivery(config, targetScheduleId);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function loadScheduleFiles(agentsDir: string): Promise<LoadedScheduleFile[]> {
  const entries = await fs.readdir(agentsDir, { withFileTypes: true });
  const results: LoadedScheduleFile[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;

    const agentId = entry.name;
    const schedulesDir = path.join(agentsDir, agentId, 'schedules');
    let files: string[];
    try {
      files = await fs.readdir(schedulesDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }

    for (const file of files) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;

      results.push(await loadScheduleFile(agentsDir, path.join(schedulesDir, file)));
    }
  }

  return results.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
}

async function loadScheduleFile(agentsDir: string, filePath: string): Promise<LoadedScheduleFile> {
  const filename = path.basename(filePath);
  const filenameId = filename.replace(/\.ya?ml$/, '');
  const agentId = inferAgentIdFromSchedulePath(agentsDir, filePath);
  const canonicalId = `${agentId}/${filenameId}`;
  const checks: ScheduleCheck[] = [];
  let spec: ScheduleSpec | null = null;

  try {
    if (!filename.endsWith('.yaml') && !filename.endsWith('.yml')) {
      checks.push({ level: 'error', file: filePath, scheduleId: canonicalId, message: 'schedule file must end with .yaml or .yml' });
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = parseYaml(content);
    const validation = safeValidateScheduleSpec(parsed);

    if (!validation.success) {
      checks.push({
        level: 'error',
        file: filePath,
        scheduleId: canonicalId,
        message: validation.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; '),
      });
    } else {
      spec = { ...validation.data, id: canonicalId };
      checks.push(...validateScheduleSemantics(agentId, filenameId, filePath, validation.data, spec));
      checks.push(...validateAiAuthoringConventions(agentId, filePath, spec));
      if (checks.every((check) => check.level !== 'error' && check.level !== 'warn')) {
        checks.push({ level: 'ok', file: filePath, scheduleId: canonicalId, message: 'valid' });
      }
    }
  } catch (error) {
    checks.push({
      level: 'error',
      file: filePath,
      scheduleId: canonicalId,
      message: `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return { agentId, filePath, canonicalId, spec, checks };
}

function inferAgentIdFromSchedulePath(agentsDir: string, filePath: string): string {
  const relative = path.relative(agentsDir, filePath);
  const parts = relative.split(path.sep);
  if (parts.length >= 3 && parts[1] === 'schedules') return parts[0] ?? 'unknown';
  return path.basename(path.dirname(path.dirname(filePath))) || 'unknown';
}

function validateScheduleSemantics(
  agentId: string,
  filenameId: string,
  filePath: string,
  rawSpec: ScheduleSpec,
  canonicalSpec: ScheduleSpec,
): ScheduleCheck[] {
  const checks: ScheduleCheck[] = [];

  if (rawSpec.id !== filenameId) {
    checks.push({
      level: 'warn',
      file: filePath,
      scheduleId: canonicalSpec.id,
      message: `id "${rawSpec.id}" will be canonicalized to "${canonicalSpec.id}" from the filename`,
    });
  }

  if (canonicalSpec.execution.agent !== agentId) {
    checks.push({
      level: 'warn',
      file: filePath,
      scheduleId: canonicalSpec.id,
      message: `execution.agent is "${canonicalSpec.execution.agent}" but file is under agent "${agentId}"`,
    });
  }

  switch (canonicalSpec.trigger.type) {
    case 'cron': {
      if (!canonicalSpec.trigger.cron) {
        checks.push({ level: 'error', file: filePath, scheduleId: canonicalSpec.id, message: 'trigger.cron is required' });
      } else if (!cron.validate(canonicalSpec.trigger.cron)) {
        checks.push({
          level: 'error',
          file: filePath,
          scheduleId: canonicalSpec.id,
          message: `invalid cron expression: ${canonicalSpec.trigger.cron}`,
        });
      }
      break;
    }
    case 'once': {
      if (!canonicalSpec.trigger.at) {
        checks.push({ level: 'error', file: filePath, scheduleId: canonicalSpec.id, message: 'trigger.at is required for once schedules' });
      } else {
        const at = new Date(canonicalSpec.trigger.at);
        if (Number.isNaN(at.getTime())) {
          checks.push({ level: 'error', file: filePath, scheduleId: canonicalSpec.id, message: `invalid trigger.at: ${canonicalSpec.trigger.at}` });
        } else if (at.getTime() <= Date.now()) {
          checks.push({ level: 'warn', file: filePath, scheduleId: canonicalSpec.id, message: `once schedule is in the past: ${canonicalSpec.trigger.at}` });
        }
      }
      break;
    }
    case 'interval': {
      if (!canonicalSpec.trigger.interval || canonicalSpec.trigger.interval < 60_000) {
        checks.push({
          level: 'error',
          file: filePath,
          scheduleId: canonicalSpec.id,
          message: `interval schedules require trigger.interval >= 60000ms`,
        });
      }
      break;
    }
  }

  if (canonicalSpec.output?.mode === 'thread') {
    const hasOutputChannel = Boolean(canonicalSpec.output.channelId || canonicalSpec.output.forumChannelId);
    const hasNotificationTarget = Boolean(canonicalSpec.notification?.targets?.[0]?.chatId);
    if (!hasOutputChannel && !hasNotificationTarget) {
      checks.push({
        level: 'error',
        file: filePath,
        scheduleId: canonicalSpec.id,
        message: 'thread output requires output.channelId/forumChannelId or notification.targets[0].chatId',
      });
    }
  }

  for (const target of canonicalSpec.notification?.targets ?? []) {
    if (!/^\d+$/.test(target.chatId)) {
      checks.push({
        level: 'warn',
        file: filePath,
        scheduleId: canonicalSpec.id,
        message: `notification target chatId "${target.chatId}" is not a numeric Discord channel id`,
      });
    }
  }

  for (const [field, value] of Object.entries({
    channelId: canonicalSpec.output?.channelId,
    forumChannelId: canonicalSpec.output?.forumChannelId,
  })) {
    if (value !== undefined && !/^\d+$/.test(value)) {
      checks.push({
        level: 'warn',
        file: filePath,
        scheduleId: canonicalSpec.id,
        message: `output.${field} "${value}" is not a numeric Discord channel id`,
      });
    }
  }

  return checks;
}

function validateAiAuthoringConventions(
  agentId: string,
  filePath: string,
  spec: ScheduleSpec,
): ScheduleCheck[] {
  const checks: ScheduleCheck[] = [];
  const prompt = spec.execution.prompt.trim();
  const promptLower = prompt.toLowerCase();
  const recurring = spec.trigger.type === 'cron' || spec.trigger.type === 'interval';
  const threadMode = spec.output?.mode === 'thread';
  const delivery = spec.output?.delivery ?? 'last-only';

  const warn = (message: string): void => {
    checks.push({ level: 'warn', file: filePath, scheduleId: spec.id, message });
  };

  if (prompt.length < 80) {
    warn('execution.prompt is very short; AI-authored schedules should include goal, inputs, output contract, and failure behavior');
  }

  if (spec.execution.agent !== agentId) {
    warn(`execution.agent "${spec.execution.agent}" differs from inferred agent folder "${agentId}"`);
  }

  if (threadMode && delivery === 'last-only' && !containsAny(promptLower, [
    'final response', '最後回覆', '最後輸出', '完整輸出', 'discord', 'thread',
  ])) {
    warn('thread/last-only schedules should require the final response to contain the complete user-facing result');
  }

  if (threadMode && delivery === 'summary') {
    warn('thread/summary is for execution digests; use last-only when the final report itself should be delivered');
  }

  if (recurring) {
    if (!containsAny(promptLower, [
      'no change', 'no-change', 'low signal', 'low-signal', 'insufficient signal',
      'skip', 'monitoring', '沒有變化', '無變化', '低訊號', '訊號不足', '不硬產',
    ])) {
      warn('recurring schedules should define what to do on no-change or low-signal runs');
    }

    if (!containsAny(promptLower, [
      'previous', 'recent', 'history', 'last run', 'yesterday', 'state',
      '上次', '昨日', '昨天', '近期', '歷史', '追蹤', '延續',
    ])) {
      warn('recurring schedules should compare against recent history or previous output when useful');
    }

    if (!containsAny(promptLower, [
      'validate', 'verify', 'check', 'if fail', 'failure', 'error', 'fallback',
      '驗證', '檢查', '失敗', '錯誤', '資料不足', '降級',
    ])) {
      warn('recurring schedules should describe validation/fallback behavior for missing inputs or failed APIs');
    }
  }

  if (!containsAny(promptLower, [
    'markdown', 'json', 'format', '格式', '輸出格式', 'output format',
  ])) {
    warn('schedule prompt should define a concrete output format');
  }

  return checks;
}

function containsAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function printScheduleList(files: LoadedScheduleFile[]): void {
  if (files.length === 0) {
    console.log('No schedule files found.');
    return;
  }

  for (const file of files) {
    const spec = file.spec;
    const status = file.checks.some((check) => check.level === 'error')
      ? 'error'
      : file.checks.some((check) => check.level === 'warn')
        ? 'warn'
        : 'ok';
    const enabled = spec?.metadata.enabled === false ? 'disabled' : 'enabled';
    const trigger = spec ? formatTrigger(spec) : 'invalid';
    const output = spec ? formatOutput(spec) : 'invalid';
    console.log(`${status.padEnd(5)} ${enabled.padEnd(8)} ${file.canonicalId.padEnd(32)} ${output.padEnd(24)} ${trigger}`);
  }
}

function printValidation(files: LoadedScheduleFile[]): void {
  printScheduleList(files);
  console.log('');

  let detailCount = 0;
  for (const file of files) {
    for (const check of file.checks) {
      if (check.level === 'ok') continue;
      detailCount++;
      console.log(`[${check.level}] ${check.scheduleId}`);
      console.log(`  ${path.relative(process.cwd(), check.file)}`);
      console.log(`  ${check.message}`);
    }
  }

  if (detailCount === 0) {
    console.log(`All ${files.length} schedule file(s) are valid.`);
  } else {
    console.log('');
    console.log(`Validation finished with ${detailCount} warning/error item(s).`);
    if (!strictMode) {
      console.log('Use --strict to fail on warnings.');
    }
  }
}

function throwIfErrors(files: LoadedScheduleFile[]): void {
  const errors = files.flatMap((file) => file.checks).filter((check) => check.level === 'error');
  if (errors.length > 0) {
    throw new Error(`Schedule validation failed with ${errors.length} error(s).`);
  }
}

function throwIfStrictWarnings(files: LoadedScheduleFile[]): void {
  if (!strictMode) return;
  const warnings = files.flatMap((file) => file.checks).filter((check) => check.level === 'warn');
  if (warnings.length > 0) {
    throw new Error(`Strict schedule validation failed with ${warnings.length} warning(s).`);
  }
}

function formatTrigger(spec: ScheduleSpec): string {
  if (spec.trigger.type === 'cron') return `cron "${spec.trigger.cron}" ${spec.trigger.timezone}`;
  if (spec.trigger.type === 'once') return `once ${spec.trigger.at} ${spec.trigger.timezone}`;
  return `interval ${spec.trigger.interval}ms ${spec.trigger.timezone}`;
}

function formatOutput(spec: ScheduleSpec): string {
  const mode = spec.output?.mode ?? 'message';
  const delivery = spec.output?.delivery ?? 'last-only';
  const target = spec.output?.channelId ?? spec.output?.forumChannelId ?? spec.notification?.targets?.[0]?.chatId ?? 'no-target';
  return `${mode}/${delivery}/${target}`;
}

async function runSchedule(config: ReturnType<typeof loadAppConfig>, scheduleId: string): Promise<void> {
  const selected = await findSchedule(config.agentsDir, scheduleId);

  const agentLoader = new AgentLoader({ agentsDir: config.agentsDir });
  const sdkSessionManager = new SDKSessionManager({
    ephemeral: true,
    maxSessions: 1,
    idleCloseMs: 0,
    keepaliveConfig: { ...config.cacheKeepalive, enabled: false },
  });
  const executor = new ScheduleExecutor(
    agentLoader,
    sdkSessionManager,
    new ScheduleNotifier(new Map()),
  );

  try {
    console.log(`Running ${scheduleId} without Discord delivery...`);
    const result = await executor.execute(selected.agentId, selected.spec);
    console.log(`success=${result.success} durationMs=${result.duration}`);
    if (result.result?.response) {
      console.log('');
      console.log(result.result.response);
    }
    if (!result.success) {
      throw new Error(result.error instanceof Error ? result.error.message : String(result.error));
    }
  } finally {
    executor.dispose();
  }
}

async function triggerScheduleWithDiscordDelivery(
  config: ReturnType<typeof loadAppConfig>,
  scheduleId: string,
): Promise<void> {
  const selected = await findSchedule(config.agentsDir, scheduleId);
  const agentLoader = new AgentLoader({ agentsDir: config.agentsDir });
  const agent = await agentLoader.loadAgent(selected.agentId);
  const token = agent.config.discordBotToken;
  if (!token) {
    throw new Error(`Agent ${selected.agentId} has no discordBotToken.`);
  }

  const sdkSessionManager = new SDKSessionManager({
    ephemeral: true,
    maxSessions: 1,
    idleCloseMs: 0,
    keepaliveConfig: { ...config.cacheKeepalive, enabled: false },
  });
  const persistence = initializeCliPersistence(config);
  const restAdapter = new RestDiscordScheduleAdapter(selected.agentId, token);
  const notifier = new ScheduleNotifier(new Map([[selected.agentId, restAdapter as unknown as BaseAdapter]]));
  const executor = new ScheduleExecutor(
    agentLoader,
    sdkSessionManager,
    notifier,
    undefined,
    undefined,
    persistence?.sessionRepository,
  );

  try {
    console.log(`Triggering ${scheduleId} with Discord delivery...`);
    if (!persistence) {
      console.warn('Persistence is disabled; created schedule threads will not support follow-up resume.');
    }
    const result = await executor.execute(selected.agentId, selected.spec);
    console.log(`success=${result.success} durationMs=${result.duration}`);
    if (!result.success) {
      throw new Error(result.error instanceof Error ? result.error.message : String(result.error));
    }
  } finally {
    executor.dispose();
    persistence?.databaseManager.close();
  }
}

function initializeCliPersistence(
  config: ReturnType<typeof loadAppConfig>,
): { databaseManager: DatabaseManager; sessionRepository: SessionRepository } | null {
  if (!config.persistence.enabled) return null;

  const databaseManager = new DatabaseManager({ dbPath: config.persistence.dbPath });
  databaseManager.initialize();
  return {
    databaseManager,
    sessionRepository: new SessionRepository(databaseManager.getDatabase()),
  };
}

async function testDiscordThreadDelivery(config: ReturnType<typeof loadAppConfig>, scheduleId: string): Promise<void> {
  const { agentId, spec } = await findSchedule(config.agentsDir, scheduleId);
  if ((spec.output?.mode ?? 'message') !== 'thread') {
    console.warn(`Schedule ${scheduleId} output.mode is "${spec.output?.mode ?? 'message'}"; testing Discord thread creation against its target channel only.`);
  }

  const targets = resolveScheduleTargets(spec);
  if (targets.length === 0) {
    throw new Error(`Schedule ${scheduleId} has no notification.targets.`);
  }

  const agentLoader = new AgentLoader({ agentsDir: config.agentsDir });
  const agent = await agentLoader.loadAgent(agentId);
  const token = agent.config.discordBotToken;
  if (!token) {
    throw new Error(`Agent ${agentId} has no discordBotToken.`);
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const now = new Date();
  const threadName = `[schedule-test] ${resolveThreadTitle(spec, now)}`;

  for (const target of targets) {
    const channelId = channelOverride ?? resolveThreadChannelId(spec, target.chatId);
    const initialContent = [
      `Schedule Discord delivery test`,
      `schedule: ${spec.id}`,
      `agent: ${agentId}`,
      `time: ${now.toISOString()}`,
    ].join('\n');

    console.log(`Creating test thread for ${spec.id} in channel ${channelId}...`);
    const message = await rest.post(Routes.channelMessages(channelId), {
      body: { content: initialContent },
    });
    const messageId = getDiscordId(message, 'message');

    const thread = await rest.post(Routes.threads(channelId, messageId), {
      body: {
        name: threadName,
        auto_archive_duration: 1440,
      },
    });
    const threadId = getDiscordId(thread, 'thread');

    await rest.post(Routes.channelMessages(threadId), {
      body: {
        content: [
          formatOwnerMention(),
          `Schedule thread send test succeeded.`,
          `schedule: ${spec.id}`,
          `delivery: ${spec.output?.delivery ?? 'last-only'}`,
        ].filter(Boolean).join('\n'),
      },
    });

    console.log(`ok ${spec.id} threadId=${threadId}`);
  }
}

async function findSchedule(
  agentsDir: string,
  scheduleId: string,
): Promise<{ agentId: string; spec: ScheduleSpec }> {
  const loader = new ScheduleLoader(agentsDir);
  const schedulesByAgent = await loader.loadAll();

  for (const [agentId, specs] of schedulesByAgent) {
    const spec = specs.find((item) => item.id === scheduleId);
    if (spec) {
      return { agentId, spec };
    }
  }

  throw new Error(`Schedule not found: ${scheduleId}`);
}

function getDiscordId(value: unknown, label: string): string {
  if (typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string') {
    return value.id;
  }
  throw new Error(`Discord ${label} response did not include an id`);
}

class RestDiscordScheduleAdapter {
  readonly platform = 'discord' as const;

  private readonly rest: REST;

  constructor(
    readonly agentId: string,
    token: string,
  ) {
    this.rest = new REST({ version: '10' }).setToken(token);
  }

  async sendMessage(chatId: string, text: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const message = await this.rest.post(Routes.channelMessages(chatId), {
        body: { content: truncateDiscordMessage(text) },
      });
      return { success: true, messageId: getDiscordId(message, 'message') };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async createThread(
    chatId: string,
    threadName: string,
    initialContent?: string,
  ): Promise<{ success: boolean; threadId?: string; error?: string }> {
    try {
      const message = await this.rest.post(Routes.channelMessages(chatId), {
        body: { content: truncateDiscordMessage(initialContent ?? threadName) },
      });
      const messageId = getDiscordId(message, 'message');
      const thread = await this.rest.post(Routes.threads(chatId, messageId), {
        body: {
          name: threadName.slice(0, 100),
          auto_archive_duration: 1440,
        },
      });
      const threadId = getDiscordId(thread, 'thread');
      await this.addOwnerToThread(threadId);
      await this.notifyOwnerInThread(threadId);
      return { success: true, threadId };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async addOwnerToThread(threadId: string): Promise<void> {
    const ownerUserId = process.env.DISCORD_OWNER_USER_ID;
    if (!ownerUserId) return;

    await this.rest.put(Routes.threadMembers(threadId, ownerUserId));
  }

  private async notifyOwnerInThread(threadId: string): Promise<void> {
    const mention = formatOwnerMention();
    if (!mention) return;

    await this.rest.post(Routes.channelMessages(threadId), {
      body: { content: `${mention} schedule thread created.` },
    });
  }
}

function truncateDiscordMessage(text: string): string {
  return text.length > 1900 ? `${text.slice(0, 1900)}\n\n[truncated]` : text;
}

function formatOwnerMention(): string | undefined {
  const ownerUserId = process.env.DISCORD_OWNER_USER_ID;
  return ownerUserId && /^\d+$/.test(ownerUserId) ? `<@${ownerUserId}>` : undefined;
}

function printHelp(): void {
  console.log([
    'Usage:',
    '  npm run schedule:list',
    '  npm run schedule:validate',
    '  npm run schedule:check -- <path-to-yaml> [--strict]',
    '  npm run schedule:run -- <agentId/scheduleId>',
    '  npm run schedule:trigger -- <agentId/scheduleId>',
    '  npm run schedule:discord-test -- <agentId/scheduleId>',
    '  npm run schedule:discord-test -- <agentId/scheduleId> --channel <discordChannelId>',
    '',
    'Notes:',
    '  validate/list read AGENTS_DIR schedules only.',
    '  check validates one YAML file and adds AI-authoring convention checks.',
    '  run executes the schedule prompt through Claude SDK but does not connect Discord or deliver output.',
    '  trigger executes the schedule prompt and performs Discord delivery through REST.',
    '  discord-test creates a real Discord thread and sends a test message, without starting a Gateway listener.',
  ].join('\n'));
}

function readArgValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
