#!/usr/bin/env npx tsx
/**
 * OSS-Coder-specific path validator with project whitelist
 *
 * Extends standard path-validator logic with external project whitelist.
 * Replaces path-validator for OSS-Coder agent only.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';

// --- Whitelist ---
const ALLOWED_PROJECTS = [
  'F:\\_Program\\OwnProject\\_My_AI\\MCP-Server\\mcp-google-map',
];

// --- Types ---
interface HookInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  cwd: string;
}

// --- Utilities ---
function normalizePath(p: string): string {
  return path.normalize(p).toLowerCase();
}

function resolvePath(inputPath: string, workspacePath: string): string {
  let normalizedInput = inputPath;
  if (process.platform === 'win32' && /^\/[a-zA-Z]\//.test(inputPath)) {
    const driveLetter = inputPath[1].toUpperCase();
    normalizedInput = `${driveLetter}:${inputPath.slice(2).replace(/\//g, '\\')}`;
  }

  const resolved = path.isAbsolute(normalizedInput)
    ? normalizedInput
    : path.resolve(workspacePath, normalizedInput);

  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function extractPath(input: Record<string, unknown>): string | null {
  const pathFields = ['file_path', 'path'];
  for (const field of pathFields) {
    const value = input[field];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

function extractPathsFromCommand(command: string): string[] {
  const paths: string[] = [];

  const quotedPattern = /["']([^"']+)["']/g;
  let match;
  while ((match = quotedPattern.exec(command)) !== null) {
    if (match[1]) paths.push(match[1]);
  }

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

function isPathAllowed(targetPath: string): boolean {
  const normalized = normalizePath(targetPath);
  return ALLOWED_PROJECTS.some(allowed =>
    normalized.startsWith(normalizePath(allowed))
  );
}

// --- Standard path-validator logic ---
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];
const WRITE_TOOLS = ['Write', 'Edit'];

function checkStandardPermission(
  toolName: string,
  normalizedPath: string,
  normalizedWorkspace: string,
  normalizedShared: string,
  normalizedExample: string,
  normalizedOwnNamespace: string,
  agentsRoot: string,
  agentId: string,
): { allowed: boolean; reason?: string } {
  const isReadOnly = READ_ONLY_TOOLS.includes(toolName);
  const isWrite = WRITE_TOOLS.includes(toolName);

  if (normalizedPath.startsWith(normalizedWorkspace)) {
    return { allowed: true };
  }

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

  // Example/template area (_example/) — read-only
  if (normalizedPath.startsWith(normalizedExample)) {
    if (isReadOnly) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `_example/ is read-only. Cannot write to template area.`,
    };
  }

  // Other agent workspaces — denied
  if (normalizedPath.startsWith(agentsRoot)) {
    return {
      allowed: false,
      reason: `Cannot access other agent workspace. Path: ${normalizedPath}`,
    };
  }

  return {
    allowed: false,
    reason: `Path outside workspace denied. Allowed: own workspace or _shared/`,
  };
}

function checkBashStandardPermission(
  normalizedPath: string,
  normalizedWorkspace: string,
  normalizedShared: string,
  normalizedExample: string,
  agentsRoot: string,
): { allowed: boolean; reason?: string } {
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

// --- Main ---
async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');

  let input: HookInput;
  try {
    input = JSON.parse(raw) as HookInput;
  } catch {
    process.exit(0);
  }

  const { tool_name, tool_input, cwd } = input;
  const workspacePath = path.resolve(cwd);

  let pathsToCheck: string[] = [];

  if (tool_name === 'Bash') {
    const command = tool_input.command;
    if (typeof command === 'string' && command.length > 0) {
      pathsToCheck = extractPathsFromCommand(command).map(p => resolvePath(p, workspacePath));
    }
  } else {
    const pathValue = extractPath(tool_input);
    if (pathValue !== null) {
      pathsToCheck = [resolvePath(pathValue, workspacePath)];
    }
  }

  const normalizedWorkspace = normalizePath(workspacePath);
  const normalizedShared = normalizePath(path.resolve(workspacePath, '..', '_shared'));
  const normalizedExample = normalizePath(path.resolve(workspacePath, '..', '_example'));
  const agentId = path.basename(workspacePath);
  const normalizedOwnNamespace = normalizePath(
    path.join(normalizedShared, 'knowledge', agentId),
  );
  const agentsRoot = normalizePath(path.dirname(workspacePath));

  if (pathsToCheck.length > 0) {
    for (const targetPath of pathsToCheck) {
      if (isPathAllowed(targetPath)) {
        process.exit(0);
      }
    }
  }

  if (tool_name === 'Bash') {
    for (const targetPath of pathsToCheck) {
      const normalized = normalizePath(targetPath);
      const result = checkBashStandardPermission(
        normalized,
        normalizedWorkspace,
        normalizedShared,
        normalizedExample,
        agentsRoot,
      );
      if (!result.allowed) {
        process.stderr.write(
          JSON.stringify({
            decision: 'block',
            reason: result.reason,
          }),
        );
        process.exit(2);
      }
    }
    process.exit(0);
  }

  if (pathsToCheck.length > 0) {
    const normalized = normalizePath(pathsToCheck[0]);
    const result = checkStandardPermission(
      tool_name,
      normalized,
      normalizedWorkspace,
      normalizedShared,
      normalizedExample,
      normalizedOwnNamespace,
      agentsRoot,
      agentId,
    );
    if (!result.allowed) {
      process.stderr.write(
        JSON.stringify({
          decision: 'block',
          reason: result.reason,
        }),
      );
      process.exit(2);
    }
  }

  process.exit(0);
}

main().catch(() => {
  process.exit(0);
});
