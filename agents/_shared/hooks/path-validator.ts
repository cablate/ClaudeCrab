#!/usr/bin/env npx tsx
/**
 * External PathValidator Hook for Claude Code PreToolUse
 *
 * Reads hook input from stdin, validates path access based on cwd (agent directory),
 * and outputs deny decision to stderr with exit code 2 if access is denied.
 *
 * Usage in settings.local.json:
 * {
 *   "hooks": {
 *     "PreToolUse": [{
 *       "matcher": "Write|Edit|Bash|Read|Glob|Grep",
 *       "hooks": [{
 *         "type": "command",
 *         "command": "npx tsx ../_shared/hooks/path-validator.ts"
 *       }]
 *     }]
 *   }
 * }
 */

import * as path from 'node:path';
import * as fs from 'node:fs';

// --- Types ---

interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  cwd: string;
}

interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

// --- Constants ---

const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];
const WRITE_TOOLS = ['Write', 'Edit'];
const PATH_FIELDS = ['file_path', 'path'];

// --- Path Utilities ---

function normalizePath(p: string): string {
  return path.normalize(p).toLowerCase();
}

function resolvePath(inputPath: string, workspacePath: string): string {
  const resolved = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(workspacePath, inputPath);

  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

// --- Extraction ---

function extractPath(input: Record<string, unknown>): string | null {
  for (const field of PATH_FIELDS) {
    const value = input[field];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

function extractPathsFromCommand(command: string): string[] {
  const paths: string[] = [];

  // Quoted paths
  const quotedPattern = /["']([^"']+)["']/g;
  let match;
  while ((match = quotedPattern.exec(command)) !== null) {
    if (match[1]) paths.push(match[1]);
  }

  // Path-like tokens
  const tokens = command.split(/\s+/);
  for (const token of tokens) {
    if (!token || token.startsWith('-')) continue;
    const cleaned = token.replace(/^["']|["']$/g, '');
    if (
      cleaned.includes('..') ||
      cleaned.startsWith('/') ||
      cleaned.startsWith('./') ||
      /^[A-Za-z]:[/\\]/.test(cleaned)
    ) {
      if (!paths.includes(cleaned)) {
        paths.push(cleaned);
      }
    }
  }

  return paths;
}

// --- Validation Logic ---

function checkPermission(
  toolName: string,
  normalizedPath: string,
  normalizedWorkspace: string,
  normalizedShared: string,
  normalizedExample: string,
  normalizedOwnNamespace: string,
  agentsRoot: string,
  agentId: string,
): ValidationResult {
  const isReadOnly = READ_ONLY_TOOLS.includes(toolName);
  const isWrite = WRITE_TOOLS.includes(toolName);

  // 1. Own workspace — full access
  if (normalizedPath.startsWith(normalizedWorkspace)) {
    return { allowed: true };
  }

  // 2. Shared area (_shared/)
  if (normalizedPath.startsWith(normalizedShared)) {
    if (isReadOnly) {
      return { allowed: true };
    }
    if (isWrite) {
      if (normalizedPath.startsWith(normalizedOwnNamespace)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `Cannot write to other agent's shared namespace. Allowed: _shared/knowledge/${agentId}/`,
      };
    }
    return {
      allowed: false,
      reason: `Unknown tool accessing shared area: ${toolName}`,
    };
  }

  // 3. Example/template area (_example/) — read-only
  if (normalizedPath.startsWith(normalizedExample)) {
    if (isReadOnly) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `_example/ is read-only. Cannot write to template area.`,
    };
  }

  // 4. Other agent workspaces — denied
  if (normalizedPath.startsWith(agentsRoot)) {
    return {
      allowed: false,
      reason: `Cannot access other agent workspace. Path: ${normalizedPath}`,
    };
  }

  // 5. Paths outside agents/ — denied
  return {
    allowed: false,
    reason: `Path outside workspace denied. Allowed: own workspace or _shared/`,
  };
}

function checkBashPathPermission(
  normalizedPath: string,
  normalizedWorkspace: string,
  normalizedShared: string,
  normalizedExample: string,
  agentsRoot: string,
): ValidationResult {
  if (normalizedPath.startsWith(normalizedWorkspace)) {
    return { allowed: true };
  }
  if (normalizedPath.startsWith(normalizedShared)) {
    return { allowed: true };
  }
  if (normalizedPath.startsWith(normalizedExample)) {
    return { allowed: true };
  }
  if (normalizedPath.startsWith(agentsRoot)) {
    return {
      allowed: false,
      reason: `Bash: Cannot access other agent workspace. Path: ${normalizedPath}`,
    };
  }
  return {
    allowed: false,
    reason: `Bash: Path outside agents/ denied. Path: ${normalizedPath}`,
  };
}

function validate(
  toolName: string,
  toolInput: Record<string, unknown>,
  workspacePath: string,
  sharedPath: string,
  agentId: string,
): ValidationResult {
  const normalizedWorkspace = normalizePath(workspacePath);
  const normalizedShared = normalizePath(sharedPath);
  const normalizedExample = normalizePath(path.resolve(workspacePath, '..', '_example'));
  const normalizedOwnNamespace = normalizePath(
    path.join(sharedPath, 'knowledge', agentId),
  );
  const agentsRoot = normalizePath(path.dirname(workspacePath));

  // Bash — check extracted paths
  if (toolName === 'Bash') {
    const command = toolInput.command;
    if (typeof command !== 'string' || command.length === 0) {
      return { allowed: true };
    }
    const paths = extractPathsFromCommand(command);
    for (const p of paths) {
      const absolutePath = resolvePath(p, workspacePath);
      const normalized = normalizePath(absolutePath);
      const result = checkBashPathPermission(
        normalized,
        normalizedWorkspace,
        normalizedShared,
        normalizedExample,
        agentsRoot,
      );
      if (!result.allowed) return result;
    }
    return { allowed: true };
  }

  // Other tools — check path field
  const pathValue = extractPath(toolInput);
  if (pathValue === null) {
    return { allowed: true };
  }

  const absolutePath = resolvePath(pathValue, workspacePath);
  const normalized = normalizePath(absolutePath);

  return checkPermission(
    toolName,
    normalized,
    normalizedWorkspace,
    normalizedShared,
    normalizedExample,
    normalizedOwnNamespace,
    agentsRoot,
    agentId,
  );
}

// --- Main ---

async function main(): Promise<void> {
  // Read stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');

  let input: HookInput;
  try {
    input = JSON.parse(raw) as HookInput;
  } catch {
    // Cannot parse input — allow (don't break the tool)
    process.exit(0);
  }

  const { tool_name, tool_input, cwd } = input;

  // cwd is the agent directory (workspace)
  const workspacePath = path.resolve(cwd);
  const sharedPath = path.resolve(workspacePath, '..', '_shared');
  const agentId = path.basename(workspacePath);

  const result = validate(tool_name, tool_input ?? {}, workspacePath, sharedPath, agentId);

  if (!result.allowed) {
    process.stderr.write(
      JSON.stringify({
        decision: 'block',
        reason: result.reason ?? 'Path access denied',
      }),
    );
    process.exit(2);
  }

  // Allowed — exit 0 silently
  process.exit(0);
}

main().catch(() => {
  // On error, allow (don't break the tool)
  process.exit(0);
});
