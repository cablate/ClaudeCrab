import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * Options for PathValidator
 */
export interface PathValidatorOptions {
  /** Agent ID */
  agentId: string;
  /** Agent workspace absolute path */
  workspacePath: string;
  /** Shared area absolute path (agents/_shared) */
  sharedPath: string;
}

/**
 * Path validation result
 */
export interface PathValidationResult {
  /** Whether the path access is allowed */
  allowed: boolean;
  /** Reason for denial (if not allowed) */
  reason?: string;
}

/**
 * PathValidator enforces workspace isolation for agents.
 * 
 * Rules:
 * - Read/Write allowed: agent's own workspace
 * - Read allowed: entire shared area (_shared/knowledge/)
 * - Write allowed: only agent's own namespace in shared area (_shared/knowledge/{agentId}/)
 * - All other paths: denied
 */
export class PathValidator {
  private readonly normalizedWorkspace: string;
  private readonly normalizedShared: string;
  private readonly normalizedOwnNamespace: string;
  private readonly agentsRoot: string;

  // Tools that only read (don't modify files)
  private static readonly READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];
  
  // Tools that modify files
  private static readonly WRITE_TOOLS = ['Write', 'Edit'];

  // Path parameter field names for different tools
  private static readonly PATH_FIELDS = ['file_path', 'path'];

  // Bash commands that access files (for path extraction)
  private static readonly BASH_FILE_COMMANDS = [
    'cat', 'head', 'tail', 'less', 'more', 'vim', 'nano', 'code',
    'ls', 'dir', 'find', 'tree',
    'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch',
    'grep', 'rg', 'ag', 'awk', 'sed',
    'cd', 'pushd', 'popd',
  ];

  constructor(private readonly options: PathValidatorOptions) {
    // Pre-normalize paths for efficient comparison
    this.normalizedWorkspace = this.normalizePath(options.workspacePath);
    this.normalizedShared = this.normalizePath(options.sharedPath);
    this.normalizedOwnNamespace = this.normalizePath(
      path.join(options.sharedPath, 'knowledge', options.agentId)
    );
    // agents/ root directory (parent of workspace)
    this.agentsRoot = this.normalizePath(path.dirname(options.workspacePath));
  }

  /**
   * Validate a tool's path access
   */
  validate(toolName: string, toolInput: Record<string, unknown>): PathValidationResult {
    // Special handling for Bash
    if (toolName === 'Bash') {
      return this.validateBashCommand(toolInput);
    }

    const pathValue = this.extractPath(toolInput);
    
    // No path parameter - allow (tool doesn't access file system)
    if (pathValue === null) {
      return { allowed: true };
    }

    // Resolve to absolute path
    const absolutePath = this.resolvePath(pathValue);
    
    // Normalize for comparison
    const normalized = this.normalizePath(absolutePath);

    return this.checkPermission(toolName, normalized);
  }

  /**
   * Validate Bash command for path access
   */
  private validateBashCommand(input: Record<string, unknown>): PathValidationResult {
    const command = input.command;
    if (typeof command !== 'string' || command.length === 0) {
      return { allowed: true };
    }

    // Extract potential paths from the command
    const paths = this.extractPathsFromCommand(command);

    for (const p of paths) {
      const absolutePath = this.resolvePath(p);
      const normalized = this.normalizePath(absolutePath);

      // Check if path escapes to other agent workspaces
      const result = this.checkBashPathPermission(normalized);
      if (!result.allowed) {
        return result;
      }
    }

    return { allowed: true };
  }

  /**
   * Extract potential file paths from a bash command
   */
  private extractPathsFromCommand(command: string): string[] {
    const paths: string[] = [];

    // Pattern 1: Quoted paths (single or double quotes)
    const quotedPattern = /["']([^"']+)["']/g;
    let match;
    while ((match = quotedPattern.exec(command)) !== null) {
      if (match[1]) paths.push(match[1]);
    }

    // Pattern 2: Split by whitespace and find path-like tokens
    const tokens = command.split(/\s+/);
    for (const token of tokens) {
      if (!token || token.startsWith('-')) continue; // Skip flags
      
      // Remove surrounding quotes if any
      const cleaned = token.replace(/^["']|["']$/g, '');
      
      // Check if looks like a path
      if (
        cleaned.includes('..') || 
        cleaned.startsWith('/') || 
        cleaned.startsWith('./') ||
        /^[A-Za-z]:[\\\/]/.test(cleaned)  // Windows absolute path
      ) {
        if (!paths.includes(cleaned)) {
          paths.push(cleaned);
        }
      }
    }

    return paths;
  }

  /**
   * Check if a path from Bash command is allowed
   */
  private checkBashPathPermission(normalizedPath: string): PathValidationResult {
    // 1. Own workspace - allowed
    if (normalizedPath.startsWith(this.normalizedWorkspace)) {
      return { allowed: true };
    }

    // 2. Shared area - allowed (Bash is treated as read for simplicity)
    if (normalizedPath.startsWith(this.normalizedShared)) {
      return { allowed: true };
    }

    // 3. Other agent workspaces
    if (normalizedPath.startsWith(this.agentsRoot)) {
      return {
        allowed: false,
        reason: `Bash: Cannot access other agent workspace. Path: ${normalizedPath}`,
      };
    }

    // 4. Paths outside agents/ - deny
    return {
      allowed: false,
      reason: `Bash: Path outside agents/ denied. Path: ${normalizedPath}`,
    };
  }

  /**
   * Extract path value from tool input
   */
  private extractPath(input: Record<string, unknown>): string | null {
    for (const field of PathValidator.PATH_FIELDS) {
      const value = input[field];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    return null;
  }

  /**
   * Resolve path to absolute, handling symlinks
   */
  private resolvePath(inputPath: string): string {
    // Resolve relative to workspace
    const resolved = path.isAbsolute(inputPath)
      ? inputPath
      : path.resolve(this.options.workspacePath, inputPath);

    // Try to resolve symlinks (realpath), fall back to resolved if file doesn't exist
    try {
      return fs.realpathSync(resolved);
    } catch {
      // File doesn't exist yet (for Write) - use resolved path
      return resolved;
    }
  }

  /**
   * Normalize path for consistent comparison
   */
  private normalizePath(p: string): string {
    // Normalize separators and resolve .. etc
    return path.normalize(p).toLowerCase();
  }

  /**
   * Check if tool operation is allowed for the given path
   */
  private checkPermission(toolName: string, normalizedPath: string): PathValidationResult {
    const isReadOnly = PathValidator.READ_ONLY_TOOLS.includes(toolName);
    const isWrite = PathValidator.WRITE_TOOLS.includes(toolName);

    // 1. Own workspace - full access
    if (normalizedPath.startsWith(this.normalizedWorkspace)) {
      return { allowed: true };
    }

    // 2. Shared area
    if (normalizedPath.startsWith(this.normalizedShared)) {
      // Read: allowed everywhere in shared
      if (isReadOnly) {
        return { allowed: true };
      }

      // Write: only to own namespace
      if (isWrite) {
        if (normalizedPath.startsWith(this.normalizedOwnNamespace)) {
          return { allowed: true };
        }
        return {
          allowed: false,
          reason: `Cannot write to other agent's shared namespace. Allowed: _shared/knowledge/${this.options.agentId}/`,
        };
      }

      // Unknown tool type in shared area - deny for safety
      return {
        allowed: false,
        reason: `Unknown tool accessing shared area: ${toolName}`,
      };
    }

    // 3. Other paths - denied
    return {
      allowed: false,
      reason: `Path outside workspace denied. Allowed: own workspace or _shared/`,
    };
  }
}
