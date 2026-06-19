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
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
