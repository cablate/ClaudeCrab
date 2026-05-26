/**
 * JSONL Sanitizer — Prevents Claude Code's C26 readFileState rebuild
 * from injecting file modification diffs into every system-reminder.
 *
 * Background: Claude Code's Agent SDK rebuilds readFileState from JSONL
 * on every submitMessage(). The C26 function collects Read (without offset/limit)
 * and Write (with file_path + content) tool_use blocks, setting all entries to
 * offset: undefined → stale check tracks them → injects diff every turn.
 *
 * Solution: Patch JSONL before resume so C26's collection conditions fail:
 *   - Read: add offset=1 → C26 skips (requires offset === undefined)
 *   - Write: remove content → C26 skips (requires file_path && content)
 *   - Edit: not processed by C26 → no action needed
 */

import { readFileSync, writeFileSync, copyFileSync, statSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger.js';

/** Result of sanitizing a JSONL file */
export interface SanitizeResult {
  /** Number of Read tool_use blocks patched */
  readsPatched: number;
  /** Number of Write tool_use blocks patched */
  writesPatched: number;
  /** Total lines processed */
  totalLines: number;
  /** File size in bytes before sanitization */
  fileSizeBytes: number;
  /** Time taken in milliseconds */
  durationMs: number;
}

interface ToolUseBlock {
  type: 'tool_use';
  name: string;
  id: string;
  input: Record<string, unknown>;
}

interface JsonlMessage {
  type: string;
  message?: {
    content?: Array<ToolUseBlock | Record<string, unknown>>;
  };
  [key: string]: unknown;
}

/**
 * Compute Claude Code's project-hash directory name.
 * Reverse-engineered from cli.js ID() + bmK().
 */
export function projectHash(cwd: string): string {
  const result = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  if (result.length <= 200) return result;

  // bmK hash: charCode loop → base36
  let h = 0;
  for (let i = 0; i < cwd.length; i++) {
    h = (h << 5) - h + cwd.charCodeAt(i);
    h |= 0; // 32-bit signed int
  }
  return result.slice(0, 200) + '-' + Math.abs(h).toString(36);
}

/**
 * Get the JSONL file path for a given session.
 */
export function getJsonlPath(cwd: string, sessionId: string): string {
  return join(homedir(), '.claude', 'projects', projectHash(cwd), `${sessionId}.jsonl`);
}

/**
 * Sanitize a JSONL file to prevent C26 readFileState rebuild.
 *
 * Modifies the file in-place (no backup — called on every resume).
 * Silently returns empty result if file doesn't exist.
 */
export function sanitizeJsonl(jsonlPath: string): SanitizeResult {
  const startTime = performance.now();
  const emptyResult: SanitizeResult = {
    readsPatched: 0,
    writesPatched: 0,
    totalLines: 0,
    fileSizeBytes: 0,
    durationMs: 0,
  };

  if (!existsSync(jsonlPath)) {
    return emptyResult;
  }

  let fileSizeBytes: number;
  try {
    fileSizeBytes = statSync(jsonlPath).size;
  } catch {
    return emptyResult;
  }

  const stats = { readsPatched: 0, writesPatched: 0, totalLines: 0 };
  let modified = false;

  const content = readFileSync(jsonlPath, 'utf-8');
  const lines = content.split('\n');
  const outputLines: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      outputLines.push(line);
      continue;
    }

    stats.totalLines++;

    let msg: JsonlMessage;
    try {
      msg = JSON.parse(line) as JsonlMessage;
    } catch {
      // Malformed line — keep as-is
      outputLines.push(line);
      continue;
    }

    if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) {
      outputLines.push(line);
      continue;
    }

    let lineModified = false;

    for (const block of msg.message!.content) {
      if (block.type !== 'tool_use') continue;
      const b = block as ToolUseBlock;

      // Read: add offset=1 so C26's condition (offset === undefined) fails
      if (b.name === 'Read' && b.input && b.input.offset == null) {
        b.input.offset = 1;
        stats.readsPatched++;
        lineModified = true;
      }

      // Write: remove content so C26's condition (file_path && content) fails
      if (b.name === 'Write' && b.input && 'content' in b.input) {
        delete b.input.content;
        stats.writesPatched++;
        lineModified = true;
      }
    }

    if (lineModified) {
      outputLines.push(JSON.stringify(msg));
      modified = true;
    } else {
      outputLines.push(line);
    }
  }

  // Only write back if something changed
  if (modified) {
    copyFileSync(jsonlPath, jsonlPath + '.pre-sanitize');
    writeFileSync(jsonlPath, outputLines.join('\n'), 'utf-8');
  }

  const durationMs = Math.round((performance.now() - startTime) * 100) / 100;

  return {
    readsPatched: stats.readsPatched,
    writesPatched: stats.writesPatched,
    totalLines: stats.totalLines,
    fileSizeBytes,
    durationMs,
  };
}

/**
 * Sanitize the JSONL for a given session before resume.
 * Logs metrics for future optimization.
 *
 * @returns true if sanitization was performed, false if skipped/failed
 */
export function sanitizeBeforeResume(cwd: string, sdkSessionId: string): boolean {
  try {
    const jsonlPath = getJsonlPath(cwd, sdkSessionId);
    const result = sanitizeJsonl(jsonlPath);

    if (result.readsPatched > 0 || result.writesPatched > 0) {
      logger.info(
        {
          sdkSessionId,
          readsPatched: result.readsPatched,
          writesPatched: result.writesPatched,
          totalLines: result.totalLines,
          fileSizeKB: Math.round(result.fileSizeBytes / 1024),
          durationMs: result.durationMs,
        },
        '[JsonlSanitizer] Sanitized JSONL before resume'
      );
      return true;
    }

    // Nothing to patch — file was already clean or empty
    if (result.totalLines > 0) {
      logger.info(
        {
          sdkSessionId,
          totalLines: result.totalLines,
          fileSizeKB: Math.round(result.fileSizeBytes / 1024),
          durationMs: result.durationMs,
        },
        '[JsonlSanitizer] JSONL already clean'
      );
    }

    return false;
  } catch (error) {
    // Never block resume — log and continue
    logger.warn(
      { sdkSessionId, error: error instanceof Error ? error.message : String(error) },
      '[JsonlSanitizer] Failed to sanitize JSONL, continuing without sanitization'
    );
    return false;
  }
}
