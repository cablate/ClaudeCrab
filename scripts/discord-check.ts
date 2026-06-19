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
    'ClaudeCab Discord setup check',
    `agent: ${agentId}`,
    `time: ${now}`,
  ].join('\n');

  console.log(`Sending Discord setup check message to channel ${agent.discordChannelId}...`);
  const message = await rest.post(Routes.channelMessages(agent.discordChannelId), {
    body: { content },
  });
  const messageId = getDiscordId(message, 'message');
  console.log(`ok messageId=${messageId}`);

  if (createThread) {
    const threadName = `[setup-check] ${agent.name ?? agentId}`;
    console.log(`Creating Discord setup check thread in channel ${agent.discordChannelId}...`);
    const thread = await rest.post(Routes.threads(agent.discordChannelId, messageId), {
      body: {
        name: threadName.slice(0, 100),
        auto_archive_duration: 1440,
      },
    });
    const threadId = getDiscordId(thread, 'thread');
    await rest.post(Routes.channelMessages(threadId), {
      body: { content: 'ClaudeCab Discord thread setup check succeeded.' },
    });
    console.log(`ok threadId=${threadId}`);
  }
}

export function resolveDiscordCheckConfig(options: DiscordCheckOptions): ResolvedDiscordCheckConfig {
  const agentPath = path.resolve(options.agentsDir, options.agentId, 'agent.json');
  const agent = readAgentConfig(agentPath);

  if (!agent.discordBotToken || isPlaceholder(agent.discordBotToken)) {
    throw new Error(`Agent ${options.agentId} has no usable discordBotToken in ${agentPath}.`);
  }
  if (DISCORD_ID_PATTERN.test(agent.discordBotToken)) {
    throw new Error(`Agent ${options.agentId} discordBotToken looks like a Discord ID. Paste the Bot Token, not an ID.`);
  }
  if (!agent.discordChannelId || !DISCORD_ID_PATTERN.test(agent.discordChannelId)) {
    throw new Error(`Agent ${options.agentId} has no valid numeric discordChannelId in ${agentPath}.`);
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
    throw new Error(`agent.json not found: ${agentPath}`);
  }
  const parsed = JSON.parse(readFileSync(agentPath, 'utf-8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`agent.json must be a JSON object: ${agentPath}`);
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
  throw new Error(`Discord ${label} response did not include an id.`);
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
  const detail = [`Discord setup check failed: ${message}`];

  if (status === 401 || code === 0) {
    detail.push('Action: verify agent discordBotToken is the Bot Token from Discord Developer Portal > Bot, then rerun discord:check.');
  } else if (status === 403 || code === 50001 || code === 50013) {
    detail.push('Action: verify the Agent Bot is invited to the server and has View Channels, Send Messages, Read Message History, Create Public Threads, and Send Messages in Threads permissions.');
  } else if (status === 404 || code === 10003) {
    detail.push('Action: verify agent discordChannelId is the numeric channel ID, not server ID/client ID, and that the bot can see that channel.');
  } else if (status === 429) {
    detail.push('Action: Discord rate-limited the test. Wait briefly and retry.');
  } else {
    detail.push('Action: rerun npm run setup:check, then verify token, channel ID, bot invite, and channel permissions.');
  }

  return detail.join('\n');
}

function readNumberProperty(value: unknown, key: string): number | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'number' ? raw : undefined;
}
