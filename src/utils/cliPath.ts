/**
 * Shared CLAUDE_CLI_PATH resolver — used by both SDKSessionManager (V2
 * persistent session) and SDKQueryManager (V1 one-shot query) so the env
 * var override works in every code path that spawns a Claude Code CLI,
 * including scheduled tasks and V1 fallback.
 *
 * Resolution order (only when CLAUDE_CLI_PATH is explicitly set):
 *   1. configured path (honor user intent when it works)
 *   2. sibling cli.js in the same dir (pre-2.1.119 layout)
 *   3. ../claude-code-{platform}-{arch}/claude{.exe} (2.1.119+ native binary)
 *
 * When CLAUDE_CLI_PATH is empty or unset, callers should NOT pass
 * pathToClaudeCodeExecutable to the SDK — let the SDK resolve its own
 * bundled CLI from node_modules automatically.
 *
 * See: docs/sop-sdk-cli-upgrade.md and memory project_cli-layout-change.md.
 */

import path from 'node:path';
import fs from 'node:fs/promises';

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
    path.join(pkgDir, '..', `claude-code-${process.platform}-${process.arch}`, archExe),
  ];
  for (const alt of alternates) {
    if (await exists(alt)) {
      return { path: alt, fallback: true };
    }
  }
  return null;
}
