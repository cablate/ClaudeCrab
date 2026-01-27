#!/usr/bin/env node
/* eslint-disable no-console */
import 'dotenv/config';
import * as readline from 'node:readline';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { AgentLoader } from './core/AgentLoader.js';
import { logger } from './utils/logger.js';

/**
 * CLI options
 */
interface CLIOptions {
  agentId?: string | undefined;
  agentsDir?: string | undefined;
  verbose?: boolean | undefined;
}

/**
 * Parse command line arguments
 */
function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;

    if (arg === '--agent' || arg === '-a') {
      const nextArg = args[++i];
      if (nextArg !== undefined) {
        options.agentId = nextArg;
      }
    } else if (arg === '--agents-dir' || arg === '-d') {
      const nextArg = args[++i];
      if (nextArg !== undefined) {
        options.agentsDir = nextArg;
      }
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('-') && options.agentId === undefined) {
      // First non-flag argument is agent ID
      options.agentId = arg;
    }
  }

  return options;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
ClaudeCab CLI - Interactive Agent Testing Tool

Usage:
  npm run cli [agent-id] [options]
  npx tsx src/cli.ts [agent-id] [options]

Options:
  -a, --agent <id>       Specify agent ID to use
  -d, --agents-dir <dir> Specify agents directory (default: ./agents)
  -v, --verbose          Enable verbose logging
  -h, --help             Show this help message

Commands (during chat):
  /help                  Show available commands
  /list                  List available agents
  /switch <agent-id>     Switch to a different agent
  /reset                 Reset conversation history
  /info                  Show current agent info
  /exit, /quit           Exit the CLI

Examples:
  npm run cli general
  npm run cli --agent coder
  npx tsx src/cli.ts -a general -v
`);
}

/**
 * Format agent description for display
 */
function formatAgentInfo(agent: { id: string; config: { name: string; description?: string | undefined; model?: string | undefined } }): string {
  const lines = [
    `Agent: ${agent.config.name} (${agent.id})`,
  ];

  if (agent.config.description !== undefined && agent.config.description !== '') {
    lines.push(`Description: ${agent.config.description}`);
  }

  lines.push(`Model: ${agent.config.model ?? 'sonnet'}`);

  return lines.join('\n');
}

/**
 * Main CLI class
 */
class ClaudeCabCLI {
  private readonly agentLoader: AgentLoader;
  private currentAgentId: string;
  private rl: readline.Interface | null = null;
  private verbose: boolean;

  constructor(options: CLIOptions) {
    this.agentLoader = new AgentLoader(
      options.agentsDir !== undefined ? { agentsDir: options.agentsDir } : {}
    );
    this.currentAgentId = options.agentId ?? 'general';
    this.verbose = options.verbose ?? false;
  }

  /**
   * Start the CLI
   */
  async start(): Promise<void> {
    console.log('\n🤖 ClaudeCab CLI - Interactive Agent Testing Tool\n');

    // Load the initial agent
    try {
      await this.loadAgent(this.currentAgentId);
    } catch (error) {
      console.error(`Failed to load agent "${this.currentAgentId}": ${(error as Error).message}`);
      console.log('\nAvailable agents:');
      await this.listAgents();
      process.exit(1);
    }

    // Create readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Show initial prompt
    this.printAgentInfo();
    console.log('\nType /help for available commands, /exit to quit.\n');

    // Start REPL
    this.prompt();
  }

  /**
   * Load an agent by ID
   */
  private async loadAgent(agentId: string): Promise<void> {
    if (this.verbose) {
      console.log(`Loading agent: ${agentId}...`);
    }

    const agent = await this.agentLoader.loadAgent(agentId);
    this.currentAgentId = agentId;

    if (this.verbose) {
      console.log(`Agent loaded: ${agent.config.name}`);
      console.log(`System prompt length: ${agent.systemPrompt.length} chars`);
    }
  }

  /**
   * Print current agent info
   */
  private printAgentInfo(): void {
    const agent = this.agentLoader.get(this.currentAgentId);
    if (agent) {
      console.log('\n' + formatAgentInfo(agent));
    }
  }

  /**
   * List available agents
   */
  private async listAgents(): Promise<void> {
    const agentIds = await this.agentLoader.scanAgents();

    if (agentIds.length === 0) {
      console.log('No agents found in the agents directory.');
      return;
    }

    console.log('\nAvailable agents:');
    for (const id of agentIds) {
      try {
        const agent = this.agentLoader.get(id) ?? await this.agentLoader.loadAgent(id);
        const marker = id === this.currentAgentId ? ' (current)' : '';
        console.log(`  - ${id}: ${agent.config.name}${marker}`);
      } catch {
        console.log(`  - ${id}: (failed to load)`);
      }
    }
    console.log('');
  }

  /**
   * Handle CLI command
   */
  private async handleCommand(input: string): Promise<boolean> {
    const parts = input.trim().split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);
    const arg = args.join(' ');

    if (command === undefined) {
      return false;
    }

    switch (command.toLowerCase()) {
      case '/help':
        console.log(`
Available commands:
  /help              Show this help message
  /list              List available agents
  /switch <agent>    Switch to a different agent
  /reset             Reset conversation history
  /info              Show current agent info
  /exit, /quit       Exit the CLI
`);
        return true;

      case '/list':
        await this.listAgents();
        return true;

      case '/switch':
        if (!arg) {
          console.log('Usage: /switch <agent-id>');
          return true;
        }
        try {
          await this.loadAgent(arg);
          console.log(`\nSwitched to agent: ${this.currentAgentId}`);
          this.printAgentInfo();
          console.log('');
        } catch (error) {
          console.error(`Failed to switch to agent "${arg}": ${(error as Error).message}`);
        }
        return true;

      case '/reset':
        console.log('\nConversation history cleared.\n');
        return true;

      case '/info':
        this.printAgentInfo();
        console.log('');
        return true;

      case '/exit':
      case '/quit':
        console.log('\nGoodbye! 👋\n');
        this.rl?.close();
        process.exit(0);
        break; // Unreachable but satisfies linter

      default:
        return false;
    }
  }

  /**
   * Send message to Claude using Agent SDK
   * Uses cwd + settingSources to let SDK auto-load CLAUDE.md from agent directory
   */
  private async chat(userMessage: string): Promise<void> {
    // Get agent config
    const agent = this.agentLoader.get(this.currentAgentId);
    if (!agent) {
      console.error('Agent not loaded');
      return;
    }

    try {
      // Create streaming request using Claude Agent SDK
      process.stdout.write('\n🤖 ');

      // Use agent directory as cwd
      // Pass system prompt explicitly to ensure agent isolation
      // (prevents SDK from loading parent directory's CLAUDE.md)
      const q = query({
        prompt: userMessage,
        options: {
          cwd: agent.path,
          // Use 'local' to load agent's .claude/settings.local.json (permissions)
          settingSources: ['local'],
          // Pass system prompt explicitly for agent isolation
          systemPrompt: agent.systemPrompt,
          // Allow multiple turns for tool usage
          maxTurns: 10,
          // Don't override tools - let SDK read from agent's .claude/settings.local.json
        },
      });

      for await (const message of q) {
        // Debug: show all message types in verbose mode
        if (this.verbose) {
          console.log(`[SDK] type: ${message.type}, subtype: ${'subtype' in message ? (message as { subtype?: string }).subtype : 'N/A'}`);

          // Show init message details
          if (message.type === 'system' && 'subtype' in message && (message as { subtype?: string }).subtype === 'init') {
            const initMsg = message as { model?: string; cwd?: string };
            console.log(`[SDK Init] model: ${initMsg.model}, cwd: ${initMsg.cwd}`);
          }
        }

        if (message.type === 'assistant' && message.message.content) {
          for (const block of message.message.content) {
            if (block.type === 'text') {
              process.stdout.write(block.text);
            }
          }
        }
      }

      console.log('\n');
    } catch (error) {
      console.error(`\nError: ${(error as Error).message}\n`);
    }
  }

  /**
   * Show prompt and wait for input
   */
  private prompt(): void {
    this.rl?.question('You: ', (input) => {
      void this.handleInput(input);
    });
  }

  /**
   * Handle user input
   */
  private async handleInput(input: string): Promise<void> {
    const trimmedInput = input.trim();

    if (trimmedInput === '') {
      this.prompt();
      return;
    }

    // Check if it's a command
    if (trimmedInput.startsWith('/')) {
      const handled = await this.handleCommand(trimmedInput);
      if (handled) {
        this.prompt();
        return;
      }
    }

    // Send to Claude
    await this.chat(trimmedInput);
    this.prompt();
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const options = parseArgs();

  // Suppress pino logs in non-verbose mode
  if (options.verbose !== true) {
    // Set log level to silent
    logger.level = 'silent';
  }

  const cli = new ClaudeCabCLI(options);
  await cli.start();
}

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', () => {
  console.log('\n\nGoodbye! 👋\n');
  process.exit(0);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
