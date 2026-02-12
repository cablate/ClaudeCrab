/**
 * Interactive setup wizard for ClaudeCab.
 * Usage: npm run setup
 */

import { input, confirm, select, password } from '@inquirer/prompts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const AGENTS_DIR = path.join(ROOT, 'agents');
const EXAMPLE_DIR = path.join(AGENTS_DIR, '_example');

// ─── .env helpers ───────────────────────────────────────────

interface EnvMap { [key: string]: string }

function parseEnvFile(filePath: string): { lines: string[]; map: EnvMap } {
  const lines: string[] = [];
  const map: EnvMap = {};
  if (!fs.existsSync(filePath)) return { lines, map };

  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    lines.push(line);
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      map[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  }
  return { lines, map };
}

function writeEnvFile(existing: { lines: string[]; map: EnvMap }, updates: EnvMap): void {
  const written = new Set<string>();
  const output: string[] = [];

  // Update existing lines in-place
  for (const line of existing.lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        if (key in updates) {
          output.push(`${key}=${updates[key]}`);
          written.add(key);
          continue;
        }
      }
    }
    output.push(line);
  }

  // Append new keys that weren't in existing file
  const newKeys = Object.keys(updates).filter(k => !written.has(k));
  if (newKeys.length > 0) {
    if (output.length > 0 && output[output.length - 1].trim() !== '') {
      output.push('');
    }
    for (const key of newKeys) {
      output.push(`${key}=${updates[key]}`);
    }
  }

  fs.writeFileSync(ENV_PATH, output.join('\n'));
}

// ─── Step 1: Environment ────────────────────────────────────

async function setupEnv(): Promise<void> {
  console.log('\nStep 1: Environment Configuration');
  console.log('─'.repeat(40));

  const existing = parseEnvFile(ENV_PATH);
  const updates: EnvMap = {};

  // Anthropic API Key
  const apiKey = await input({
    message: 'Anthropic API Key:',
    default: existing.map['ANTHROPIC_API_KEY'] || '',
    validate: (v) => {
      if (!v.trim()) return 'API Key is required';
      if (!v.startsWith('sk-ant-')) return 'API Key should start with "sk-ant-"';
      return true;
    },
  });
  updates['ANTHROPIC_API_KEY'] = apiKey;

  // WebUI
  const enableWebUI = await confirm({
    message: 'Enable WebUI (web dashboard)?',
    default: existing.map['WEBUI_ENABLED'] === 'true' || !existing.map['WEBUI_ENABLED'],
  });
  updates['WEBUI_ENABLED'] = String(enableWebUI);

  if (enableWebUI) {
    const webPassword = await password({
      message: 'WebUI password:',
      validate: (v) => v.trim() ? true : 'Password is required when WebUI is enabled',
    });
    updates['WEBUI_PASSWORD'] = webPassword;

    // Auto-generate JWT secret
    const jwtSecret = existing.map['WEBUI_JWT_SECRET'] || crypto.randomBytes(32).toString('hex');
    updates['WEBUI_JWT_SECRET'] = jwtSecret;
    console.log('  JWT secret: auto-generated');

    const webPort = await input({
      message: 'WebUI port:',
      default: existing.map['WEBUI_PORT'] || '3001',
      validate: (v) => {
        const n = Number(v);
        return (Number.isInteger(n) && n > 0 && n < 65536) || 'Enter a valid port number';
      },
    });
    updates['WEBUI_PORT'] = webPort;
  }

  // Persistence
  const enableDB = await confirm({
    message: 'Enable database persistence?',
    default: existing.map['ENABLE_PERSISTENCE'] === 'true',
  });
  updates['ENABLE_PERSISTENCE'] = String(enableDB);

  // Write
  writeEnvFile(existing, updates);
  console.log(`\n  .env written to ${ENV_PATH}`);
}

// ─── Step 2: Agent ──────────────────────────────────────────

async function setupAgent(): Promise<void> {
  console.log('\nStep 2: Create Your First Agent');
  console.log('─'.repeat(40));

  // Agent ID
  const agentId = await input({
    message: 'Agent ID (directory name):',
    default: 'my-assistant',
    validate: (v) => {
      if (!/^[a-z0-9-]+$/.test(v)) return 'Only lowercase letters, numbers, and hyphens allowed';
      if (v === '_example') return 'Cannot use "_example" as agent ID';
      if (fs.existsSync(path.join(AGENTS_DIR, v))) return `agents/${v}/ already exists`;
      return true;
    },
  });

  const displayName = await input({
    message: 'Display name:',
    default: 'My Assistant',
  });

  const description = await input({
    message: 'Description:',
    default: 'A general-purpose AI assistant',
  });

  const model = await select({
    message: 'Model:',
    choices: [
      { name: 'sonnet (recommended — fast & capable)', value: 'sonnet' },
      { name: 'opus (most capable, slower)', value: 'opus' },
      { name: 'haiku (fastest, most affordable)', value: 'haiku' },
    ],
    default: 'sonnet',
  });

  const token = await input({
    message: 'Telegram Bot Token (press Enter to skip):',
    default: '',
  });

  const avatar = await input({
    message: 'Avatar emoji:',
    default: '🤖',
  });

  // Copy template
  const targetDir = path.join(AGENTS_DIR, agentId);
  fs.cpSync(EXAMPLE_DIR, targetDir, { recursive: true });

  // Update agent.json
  const agentJsonPath = path.join(targetDir, 'agent.json');
  const agentConfig = JSON.parse(fs.readFileSync(agentJsonPath, 'utf-8'));
  agentConfig.name = displayName;
  agentConfig.description = description;
  agentConfig.model = model;
  if (token) {
    agentConfig.telegramBotToken = token;
  }
  agentConfig.display = {
    avatar,
    color: agentConfig.display?.color || '#6B7280',
  };
  fs.writeFileSync(agentJsonPath, JSON.stringify(agentConfig, null, 2) + '\n');

  console.log(`\n  Agent created at agents/${agentId}/`);
  console.log(`  Edit agents/${agentId}/CLAUDE.md to customize the agent's personality.`);
}

// ─── Main ───────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log('  ClaudeCab Setup');
  console.log('  ===============');

  await setupEnv();

  const createAgent = await confirm({
    message: 'Create your first agent?',
    default: true,
  });
  if (createAgent) {
    await setupAgent();
  }

  console.log('\n  Setup complete! Next steps:');
  console.log('  1. npm run dev    — start in development mode');
  console.log('  2. npm run build  — build for production');
  console.log('  3. npm start      — run production build');
  console.log('');
}

main().catch((err) => {
  if (err.name === 'ExitPromptError') {
    console.log('\nSetup cancelled.');
    process.exit(0);
  }
  console.error('\nSetup failed:', err.message);
  process.exit(1);
});
