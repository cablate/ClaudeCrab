/**
 * Shared CLAUDE_CLI_PATH resolver used by SDKSessionManager so the env var
 * override works in every code path that spawns a Claude Code CLI, including
 * scheduled tasks.
 *
 * Resolution order (only when CLAUDE_CLI_PATH is explicitly set):
 *   1. configured path (honor user intent when it works)
 *   2. sibling cli.js in the same dir (pre-2.1.119 layout)
 *   3. ../claude-agent-sdk-{platform}-{arch}/claude{.exe} (agent-sdk native binary)
 *   4. ../claude-code-{platform}-{arch}/claude{.exe} (older Claude Code native binary)
 *   5. npm global package binary
 *   6. npm global shim (claude.cmd / claude)
 *
 * When CLAUDE_CLI_PATH is empty or unset, callers should NOT pass
 * pathToClaudeCodeExecutable to the SDK — let the SDK resolve its own
 * bundled CLI from node_modules automatically.
 *
 * See: docs/sop-sdk-cli-upgrade.md and memory project_cli-layout-change.md.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { delimiter } from 'node:path';

export interface ResolvedCliPath {
  path: string;
  /** True when the configured path was missing and a fallback was chosen. */
  fallback: boolean;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function npmShimCandidates(): string[] {
  const names = process.platform === 'win32'
    ? ['claude.cmd', 'claude.exe', 'claude.ps1', 'claude']
    : ['claude'];
  const pathDirs = (process.env.PATH ?? '')
    .split(delimiter)
    .map((dir) => dir.trim())
    .filter(Boolean);
  const appData = process.env.APPDATA;
  const extraDirs = appData ? [path.join(appData, 'npm')] : [];
  const dirs = [...extraDirs, ...pathDirs];
  return dirs.flatMap((dir) => names.map((name) => path.join(dir, name)));
}

function npmPackageBinaryCandidates(): string[] {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const pathDirs = (process.env.PATH ?? '')
    .split(delimiter)
    .map((dir) => dir.trim())
    .filter(Boolean);
  const appData = process.env.APPDATA;
  const extraDirs = appData ? [path.join(appData, 'npm')] : [];
  const dirs = [...extraDirs, ...pathDirs];
  return dirs.flatMap((dir) => [
    path.join(dir, 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, exe),
    path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', exe),
  ]);
}

/**
 * Resolve a CLAUDE_CLI_PATH candidate to an actual on-disk file.
 * Returns null when nothing matched — callers should fail loudly rather
 * than hand SDK a non-existent path (avoids silent `exit code 1` spawn crash).
 */
export async function resolveCliPath(configured: string): Promise<ResolvedCliPath | null> {
  if (await exists(configured)) {
    return { path: configured, fallback: false };
  }

  const pkgDir = path.dirname(configured);
  const archExe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const alternates = [
    path.join(pkgDir, 'cli.js'),
    path.join(pkgDir, '..', `claude-agent-sdk-${process.platform}-${process.arch}`, archExe),
    path.join(pkgDir, '..', `claude-code-${process.platform}-${process.arch}`, archExe),
    path.join(pkgDir, '..', 'claude-code', 'bin', archExe),
    ...npmPackageBinaryCandidates(),
    ...npmShimCandidates(),
  ];
  for (const alt of alternates) {
    if (await exists(alt)) {
      return { path: alt, fallback: true };
    }
  }
  return null;
}
