#!/usr/bin/env npx tsx
/**
 * Coder-specific path validator with project whitelist
 * 
 * Extends standard path-validator logic with external project whitelist.
 * Replaces path-validator for Coder agent only.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';

// --- Whitelist ---
const ALLOWED_PROJECTS = [
  'E:\\CabLate_Obsidian\\01_專案Projects\\付費內容規劃\\金流串接',
  'F:\\_Program\\OwnProject\\remotions',
  'F:\\_Program\\OwnProject\\ClaudeCab',
  'F:\\_Program\\OwnProject\\Threads2',
];

// For ClaudeCab, only these subpaths within agents/ are allowed
const CLAUDECAB_AGENTS_WHITELIST = [
  'F:\\_Program\\OwnProject\\ClaudeCab\\agents\\coder',
  'F:\\_Program\\OwnProject\\ClaudeCab\\agents\\_shared',
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
  // Handle Unix-style paths on Windows (e.g., /f/... → F:\...)
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

function isPathAllowed(targetPath: string): boolean {
  const normalized = normalizePath(targetPath);
  
  // Check if in whitelist
  const matchedProject = ALLOWED_PROJECTS.find(allowed => {
    const normalizedAllowed = normalizePath(allowed);
    return normalized.startsWith(normalizedAllowed);
  });
  
  if (!matchedProject) return false;
  
  // Special handling for ClaudeCab agents/ directory
  const claudecabAgentsPath = normalizePath('F:\\_Program\\OwnProject\\ClaudeCab\\agents');
  if (normalized.startsWith(claudecabAgentsPath)) {
    // Must be in coder/ or _shared/ only
    return CLAUDECAB_AGENTS_WHITELIST.some(allowed => {
      const normalizedAllowed = normalizePath(allowed);
      return normalized.startsWith(normalizedAllowed);
    });
  }
  
  return true;
}

// --- Standard path-validator logic ---
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];
const WRITE_TOOLS = ['Write', 'Edit'];

function checkStandardPermission(
  toolName: string,
  normalizedPath: string,
  normalizedWorkspace: string,
  normalizedShared: string,
  normalizedOwnNamespace: string,
  agentsRoot: string,
  agentId: string,
): { allowed: boolean; reason?: string } {
  const isReadOnly = READ_ONLY_TOOLS.includes(toolName);
  const isWrite = WRITE_TOOLS.includes(toolName);

  // Own workspace — full access
  if (normalizedPath.startsWith(normalizedWorkspace)) {
    return { allowed: true };
  }

  // Shared area
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

  // Other agent workspaces — denied
  if (normalizedPath.startsWith(agentsRoot)) {
    return {
      allowed: false,
      reason: `Cannot access other agent workspace. Path: ${normalizedPath}`,
    };
  }

  // Paths outside agents/ — denied (unless in whitelist, checked earlier)
  return {
    allowed: false,
    reason: `Path outside workspace denied. Allowed: own workspace or _shared/`,
  };
}

function checkBashStandardPermission(
  normalizedPath: string,
  normalizedWorkspace: string,
  normalizedShared: string,
  agentsRoot: string,
): { allowed: boolean; reason?: string } {
  if (normalizedPath.startsWith(normalizedWorkspace)) {
    return { allowed: true };
  }
  if (normalizedPath.startsWith(normalizedShared)) {
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
    // Cannot parse — pass to next hook
    process.exit(0);
  }

  const { tool_name, tool_input, cwd } = input;
  const workspacePath = path.resolve(cwd);

  // Extract paths based on tool type
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
  const agentId = path.basename(workspacePath);
  const normalizedOwnNamespace = normalizePath(
    path.join(normalizedShared, 'knowledge', agentId),
  );
  const agentsRoot = normalizePath(path.dirname(workspacePath));

  // Check whitelist first
  if (pathsToCheck.length > 0) {
    for (const targetPath of pathsToCheck) {
      if (isPathAllowed(targetPath)) {
        // Path is in whitelist — allow immediately
        process.exit(0);
      }
    }
  }

  // Not in whitelist — check standard permissions
  if (tool_name === 'Bash') {
    for (const targetPath of pathsToCheck) {
      const normalized = normalizePath(targetPath);
      const result = checkBashStandardPermission(
        normalized,
        normalizedWorkspace,
        normalizedShared,
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

  // Other tools
  if (pathsToCheck.length > 0) {
    const normalized = normalizePath(pathsToCheck[0]);
    const result = checkStandardPermission(
      tool_name,
      normalized,
      normalizedWorkspace,
      normalizedShared,
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
  // On error, pass to next hook
  process.exit(0);
});
