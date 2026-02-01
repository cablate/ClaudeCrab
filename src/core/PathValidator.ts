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

  // Tools that only read (don't modify files)
  private static readonly READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];
  
  // Tools that modify files
  private static readonly WRITE_TOOLS = ['Write', 'Edit'];

  // Path parameter field names for different tools
  private static readonly PATH_FIELDS = ['file_path', 'path'];

  constructor(private readonly options: PathValidatorOptions) {
    // Pre-normalize paths for efficient comparison
    this.normalizedWorkspace = this.normalizePath(options.workspacePath);
    this.normalizedShared = this.normalizePath(options.sharedPath);
    this.normalizedOwnNamespace = this.normalizePath(
      path.join(options.sharedPath, 'knowledge', options.agentId)
    );
  }

  /**
   * Validate a tool's path access
   */
  validate(toolName: string, toolInput: Record<string, unknown>): PathValidationResult {
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
          reason: `禁止寫入其他 agent 的共享命名空間。只能寫入: _shared/knowledge/${this.options.agentId}/`,
        };
      }

      // Unknown tool type in shared area - deny for safety
      return {
        allowed: false,
        reason: `不明工具類型存取共享區: ${toolName}`,
      };
    }

    // 3. Other paths - denied
    return {
      allowed: false,
      reason: `禁止存取工作區外的路徑。允許範圍: 自己的工作區 或 _shared/`,
    };
  }
}
