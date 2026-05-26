import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { logger } from '../utils/logger.js';
import { getJsonlPath } from './SDKTranscriptDiagnostics.js';

/**
 * Restore lastTurnContextTokens from the SDK's JSONL conversation file.
 *
 * SDK stores conversation history at:
 *   ~/.claude/projects/{projectHash}/{sdkSessionId}.jsonl
 *
 * Each assistant message has message.usage with per-turn token counts.
 * The last assistant message's usage = current context size.
 */
export async function restoreContextFromJsonl(
  sdkSessionId: string,
  agentCwd: string
): Promise<number | null> {
  const jsonlPath = getJsonlPath(sdkSessionId, agentCwd);

  if (!fs.existsSync(jsonlPath)) {
    logger.debug({ sdkSessionId, jsonlPath }, 'JSONL file not found for context restore');
    return null;
  }

  // Read from the end to find the last assistant message with usage.
  // JSONL files can be large (3MB+), so read line by line from tail.
  let lastCtx: number | null = null;

  try {
    const stream = fs.createReadStream(jsonlPath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.includes('"type":"assistant"')) continue;
      try {
        const entry = JSON.parse(line) as {
          type?: string;
          message?: {
            usage?: {
              input_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            };
          };
        };
        if (entry.type !== 'assistant') continue;
        const u = entry.message?.usage;
        if (u) {
          lastCtx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        }
      } catch { /* skip malformed lines */ }
    }
  } catch (err) {
    logger.warn({ sdkSessionId, jsonlPath, err: err instanceof Error ? err.message : String(err) }, 'Failed to read JSONL for context restore');
    return null;
  }

  if (lastCtx !== null) {
    logger.info({ sdkSessionId, contextTokens: lastCtx }, 'Restored context size from JSONL');
  }

  return lastCtx;
}

/**
 * Get the JSONL file's modification time as a proxy for last session activity.
 * Returns epoch ms, or null if file doesn't exist.
 */
export function getJsonlMtimeMs(
  sdkSessionId: string,
  agentCwd: string
): number | null {
  const jsonlPath = getJsonlPath(sdkSessionId, agentCwd);
  try {
    return fs.statSync(jsonlPath).mtimeMs;
  } catch {
    return null;
  }
}
