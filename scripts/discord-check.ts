import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REST, Routes } from 'discord.js';

export interface AgentDiscordConfig {
  name?: string;
  discordBotToken?: string;
  discordChannelId?: string;
}

export interface DiscordCheckOptions {
  agentId: string;
  agentsDir: string;
  createThread: boolean;
}

export interface ResolvedDiscordCheckConfig {
  agentId: string;
  agentPath: string;
  agent: Required<Pick<AgentDiscordConfig, 'discordBotToken' | 'discordChannelId'>> & AgentDiscordConfig;
  createThread: boolean;
}

const DISCORD_ID_PATTERN = /^\d{15,25}$/;

async function main(): Promise<void> {
  const config = resolveDiscordCheckConfig(readOptions(process.argv.slice(2)));
  await runDiscordCheck(config);
}

export async function runDiscordCheck(config: ResolvedDiscordCheckConfig): Promise<void> {
  const { agent, agentId, createThread } = config;
  const rest = new REST({ version: '10' }).setToken(agent.discordBotToken);
  const now = new Date().toISOString();
  const content = [
    'ClaudeCab Discord 設定檢查',
    `agent: ${agentId}`,
    `time: ${now}`,
  ].join('\n');

  console.log(`正在傳送 Discord 設定檢查訊息到 channel ${agent.discordChannelId}...`);
  const message = await rest.post(Routes.channelMessages(agent.discordChannelId), {
    body: { content },
  });
  const messageId = getDiscordId(message, 'message');
  console.log(`ok messageId=${messageId}`);

  if (createThread) {
    const threadName = `[setup-check] ${agent.name ?? agentId}`;
    console.log(`正在建立 Discord 設定檢查 thread（channel ${agent.discordChannelId}）...`);
    const thread = await rest.post(Routes.threads(agent.discordChannelId, messageId), {
      body: {
        name: threadName.slice(0, 100),
        auto_archive_duration: 1440,
      },
    });
    const threadId = getDiscordId(thread, 'thread');
    await rest.post(Routes.channelMessages(threadId), {
      body: { content: 'ClaudeCab Discord thread 設定檢查成功。' },
    });
    console.log(`ok threadId=${threadId}`);
  }
}

export function resolveDiscordCheckConfig(options: DiscordCheckOptions): ResolvedDiscordCheckConfig {
  const agentPath = path.resolve(options.agentsDir, options.agentId, 'agent.json');
  const agent = readAgentConfig(agentPath);

  if (!agent.discordBotToken || isPlaceholder(agent.discordBotToken)) {
    throw new Error(`Agent ${options.agentId} 在 ${agentPath} 沒有可用的 discordBotToken。`);
  }
  if (DISCORD_ID_PATTERN.test(agent.discordBotToken)) {
    throw new Error(`Agent ${options.agentId} discordBotToken 看起來像 Discord ID。請貼 Bot Token，不是 ID。`);
  }
  if (!agent.discordChannelId || !DISCORD_ID_PATTERN.test(agent.discordChannelId)) {
    throw new Error(`Agent ${options.agentId} 在 ${agentPath} 沒有有效的數字 discordChannelId。`);
  }

  return {
    agentId: options.agentId,
    agentPath,
    agent: {
      ...agent,
      discordBotToken: agent.discordBotToken,
      discordChannelId: agent.discordChannelId,
    },
    createThread: options.createThread,
  };
}

export function readOptions(args: string[], env: NodeJS.ProcessEnv = process.env): DiscordCheckOptions {
  return {
    agentId: readArg(args, '--agent') ?? 'example',
    agentsDir: readArg(args, '--agents-dir') ?? env.AGENTS_DIR ?? './agents',
    createThread: args.includes('--thread'),
  };
}

export function readAgentConfig(agentPath: string): AgentDiscordConfig {
  if (!existsSync(agentPath)) {
    throw new Error(`找不到 agent.json：${agentPath}`);
  }
  const parsed = JSON.parse(readFileSync(agentPath, 'utf-8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`agent.json 必須是 JSON 物件：${agentPath}`);
  }
  return parsed as AgentDiscordConfig;
}

function isPlaceholder(value: string): boolean {
  return value.trim() === '' ||
    value.startsWith('replace-with-') ||
    value.startsWith('your-') ||
    value.endsWith('-token') ||
    value.endsWith('-channel-id');
}

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function getDiscordId(value: unknown, label: string): string {
  if (typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string') {
    return value.id;
  }
  throw new Error(`Discord ${label} 回應未包含 id。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(describeDiscordRestError(error));
    process.exitCode = 1;
  });
}

export function describeDiscordRestError(error: unknown): string {
  const status = readNumberProperty(error, 'status');
  const code = readNumberProperty(error, 'code');
  const message = error instanceof Error ? error.message : String(error);
  const detail = [`Discord 設定檢查失敗：${message}`];

  if (status === 401 || code === 0) {
    detail.push('處置：確認 agent discordBotToken 是 Discord Developer Portal > Bot 的 Bot Token，再重跑 discord:check。');
  } else if (status === 403 || code === 50001 || code === 50013) {
    detail.push('處置：確認 Agent Bot 已加入 server，且具有 View Channels、Send Messages、Read Message History、Create Public Threads、Send Messages in Threads 權限。');
  } else if (status === 404 || code === 10003) {
    detail.push('處置：確認 agent discordChannelId 是數字 channel ID（不是 server ID / client ID），且 bot 看得到該 channel。');
  } else if (status === 429) {
    detail.push('處置：Discord 對測試訊息限流，請稍候再重試。');
  } else {
    detail.push('處置：重跑 npm run setup:check，再確認 token、channel ID、bot 邀請與 channel 權限。');
  }

  return detail.join('\n');
}

function readNumberProperty(value: unknown, key: string): number | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'number' ? raw : undefined;
}
