import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseManager } from '../src/persistence/DatabaseManager.js';

interface CommandStep {
  label: string;
  args: string[];
}

interface ActionStep {
  label: string;
  run: () => void;
}

type Step = CommandStep | ActionStep;

export interface CliCheckResult {
  bundledCandidates: string[];
  bundledCliPath?: string;
  externalVersion?: string;
  ok: boolean;
  messages: string[];
}

function main(): void {
  const passThroughArgs = process.argv.slice(2);
  const steps: Step[] = [
    { label: 'setup check', args: ['run', 'setup:check', '--', ...passThroughArgs] },
    {
      label: 'example schedule check',
      args: ['run', 'schedule:check', '--', 'agents/example/schedules/example-daily-check.yaml', '--strict'],
    },
    { label: 'SDK patch check', args: ['scripts/patch-sdk-v2.cjs', '--check'] },
    { label: 'Claude CLI check', run: () => printCliCheck(runClaudeCliCheck(process.cwd())) },
    { label: 'temporary database init', run: () => runTempDatabaseCheck() },
    { label: 'typecheck', args: ['run', 'typecheck'] },
    { label: 'build', args: ['run', 'build'] },
  ];

  for (const step of steps) {
    console.log(`\n== ${step.label} ==`);
    try {
      if ('run' in step) {
        step.run();
        continue;
      }

      const result = step.args[0]?.endsWith('.cjs')
        ? runNode(step.args)
        : runNpm(step.args);
      if (result.error) {
        console.error(`setup:verify failed to start ${step.label}: ${result.error.message}`);
        process.exitCode = 1;
        return;
      }
      if (result.status !== 0) {
        console.error(`setup:verify failed at ${step.label}`);
        process.exitCode = result.status ?? 1;
        return;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`setup:verify failed at ${step.label}: ${reason}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log('\nsetup:verify passed. This did not send Discord messages; run discord:check separately when real token/channel are ready.');
}

function runNpm(args: string[]): ReturnType<typeof spawnSync> {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return spawnSync(process.execPath, [npmExecPath, ...args], { stdio: 'inherit', shell: false });
  }
  return spawnSync('npm', args, { stdio: 'inherit', shell: true });
}

function runNode(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, args, { stdio: 'inherit', shell: false });
}

export function runClaudeCliCheck(cwd: string): CliCheckResult {
  const bundledCandidates = getBundledCliCandidates(cwd);
  const bundledCliPath = bundledCandidates.find((candidate) => existsSync(candidate));
  const external = spawnSync('claude', ['--version'], {
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });
  const externalVersion = external.status === 0
    ? [external.stdout, external.stderr].join('\n').trim()
    : undefined;
  const messages: string[] = [];

  if (bundledCliPath !== undefined) {
    messages.push(`ok bundled CLI exists: ${path.relative(cwd, bundledCliPath).replaceAll('\\', '/')}`);
  } else {
    messages.push(`error bundled CLI package not found. Checked: ${bundledCandidates.map((candidate) => path.relative(cwd, candidate).replaceAll('\\', '/')).join(', ')}`);
  }

  if (externalVersion !== undefined && externalVersion.length > 0) {
    messages.push(`ok external claude command: ${externalVersion}`);
  } else {
    messages.push('warn external `claude --version` did not run. This is acceptable when using the SDK-bundled CLI, but OAuth users should run `claude login` on the host.');
  }

  return {
    bundledCandidates,
    bundledCliPath,
    externalVersion,
    ok: bundledCliPath !== undefined,
    messages,
  };
}

export function getBundledCliCandidates(cwd: string): string[] {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const base = path.join(cwd, 'node_modules', '@anthropic-ai');
  const packageNames = [
    `claude-agent-sdk-${process.platform}-${process.arch}`,
    ...(process.platform === 'linux' ? [`claude-agent-sdk-linux-${process.arch}-musl`] : []),
  ];
  return packageNames.map((packageName) => path.join(base, packageName, exe));
}

function printCliCheck(result: CliCheckResult): void {
  for (const message of result.messages) {
    console.log(message);
  }
  if (!result.ok) {
    throw new Error('Claude CLI platform package is missing. Run npm install and confirm optional dependencies were installed.');
  }
}

export function runTempDatabaseCheck(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'claudecab-setup-db-'));
  const dbPath = path.join(root, 'claudecab.db');
  const manager = new DatabaseManager({ dbPath, walMode: false });
  try {
    manager.initialize();
    manager.close();
    console.log(`ok temporary DB initialized: ${dbPath}`);
    return dbPath;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
