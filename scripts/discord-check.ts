import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REST, Routes } from 'discord.js';

interface AgentDiscordConfig {
  name?: string;
  discordBotToken?: string;
  discordChannelId?: string;
}

interface DiscordCheckOptions {
  agentId: string;
  agentsDir: string;
  createThread: boolean;
}

const DISCORD_ID_PATTERN = /^\d{15,25}$/;

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const agentPath = path.resolve(options.agentsDir, options.agentId, 'agent.json');
  const agent = readAgentConfig(agentPath);

  if (!agent.discordBotToken || agent.discordBotToken.startsWith('replace-with-')) {
    throw new Error(`Agent ${options.agentId} has no usable discordBotToken in ${agentPath}.`);
  }
  if (!agent.discordChannelId || !DISCORD_ID_PATTERN.test(agent.discordChannelId)) {
    throw new Error(`Agent ${options.agentId} has no valid numeric discordChannelId in ${agentPath}.`);
  }

  const rest = new REST({ version: '10' }).setToken(agent.discordBotToken);
  const now = new Date().toISOString();
  const content = [
    'ClaudeCab Discord setup check',
    `agent: ${options.agentId}`,
    `time: ${now}`,
  ].join('\n');

  console.log(`Sending Discord setup check message to channel ${agent.discordChannelId}...`);
  const message = await rest.post(Routes.channelMessages(agent.discordChannelId), {
    body: { content },
  });
  const messageId = getDiscordId(message, 'message');
  console.log(`ok messageId=${messageId}`);

  if (options.createThread) {
    const threadName = `[setup-check] ${agent.name ?? options.agentId}`;
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

function readOptions(args: string[]): DiscordCheckOptions {
  return {
    agentId: readArg(args, '--agent') ?? 'example',
    agentsDir: readArg(args, '--agents-dir') ?? process.env.AGENTS_DIR ?? './agents',
    createThread: args.includes('--thread'),
  };
}

function readAgentConfig(agentPath: string): AgentDiscordConfig {
  if (!existsSync(agentPath)) {
    throw new Error(`agent.json not found: ${agentPath}`);
  }
  const parsed = JSON.parse(readFileSync(agentPath, 'utf-8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`agent.json must be a JSON object: ${agentPath}`);
  }
  return parsed as AgentDiscordConfig;
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
