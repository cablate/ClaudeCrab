import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { projectHash } from '../lib/JsonlSanitizer.js';

export interface KeepaliveTranscriptDiagnostic {
  jsonlPath: string;
  keepaliveUserLine?: number;
  keepaliveAssistantLine?: number;
  previousLine?: number;
  previousType?: string;
  previousSubtype?: string;
  previousAttachmentType?: string;
  previousSummary?: string;
  likelyCause?: 'stop_hook_summary' | 'mcp_instructions_delta' | 'hook_blocking_error' | 'unknown';
  error?: string;
}

interface JsonlEntry {
  line: number;
  parentUuid?: string;
  uuid?: string;
  type?: string;
  subtype?: string;
  attachment?: { type?: string; hookName?: string; hookEvent?: string };
  message?: {
    role?: string;
    content?: unknown;
    usage?: {
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  hookErrors?: string[];
  hasOutput?: boolean;
}

export function getJsonlPath(sdkSessionId: string, agentCwd: string): string {
  return path.join(os.homedir(), '.claude', 'projects', projectHash(agentCwd), `${sdkSessionId}.jsonl`);
}

export function inspectLatestKeepaliveTranscript(
  sdkSessionId: string,
  agentCwd: string,
): KeepaliveTranscriptDiagnostic {
  const jsonlPath = getJsonlPath(sdkSessionId, agentCwd);
  if (!fs.existsSync(jsonlPath)) {
    return { jsonlPath, error: 'jsonl_not_found' };
  }

  let entries: JsonlEntry[];
  try {
    entries = fs.readFileSync(jsonlPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line, index) => ({ ...(JSON.parse(line) as Omit<JsonlEntry, 'line'>), line: index + 1 }));
  } catch (err) {
    return {
      jsonlPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const byUuid = new Map<string, JsonlEntry>();
  for (const entry of entries) {
    if (entry.uuid) byUuid.set(entry.uuid, entry);
  }

  const keepaliveUserIndex = findLastIndex(entries, (entry) =>
    entry.type === 'user' && contentText(entry.message?.content).trim() === "Reply with only 'ok'"
  );
  if (keepaliveUserIndex < 0) {
    return { jsonlPath, error: 'keepalive_user_prompt_not_found' };
  }

  const keepaliveUser = entries[keepaliveUserIndex];
  if (keepaliveUser === undefined) {
    return { jsonlPath, error: 'keepalive_user_prompt_not_found' };
  }
  const keepaliveAssistant = entries
    .slice(keepaliveUserIndex + 1)
    .find((entry) => entry.type === 'assistant' && entry.message?.usage !== undefined);
  const previous = keepaliveUser.parentUuid !== undefined
    ? byUuid.get(keepaliveUser.parentUuid)
    : entries[keepaliveUserIndex - 1];

  return {
    jsonlPath,
    keepaliveUserLine: keepaliveUser.line,
    ...(keepaliveAssistant !== undefined ? { keepaliveAssistantLine: keepaliveAssistant.line } : {}),
    ...(previous !== undefined ? summarizePreviousEntry(previous) : {}),
  };
}

function summarizePreviousEntry(entry: JsonlEntry): Omit<KeepaliveTranscriptDiagnostic, 'jsonlPath'> {
  const previousAttachmentType = entry.attachment?.type;
  const previousSubtype = entry.subtype;
  const previousType = entry.type;
  const likelyCause =
    previousType === 'system' && previousSubtype === 'stop_hook_summary'
      ? 'stop_hook_summary'
      : previousAttachmentType === 'mcp_instructions_delta'
        ? 'mcp_instructions_delta'
        : previousAttachmentType === 'hook_blocking_error'
          ? 'hook_blocking_error'
          : 'unknown';

  return {
    previousLine: entry.line,
    ...(previousType !== undefined ? { previousType } : {}),
    ...(previousSubtype !== undefined ? { previousSubtype } : {}),
    ...(previousAttachmentType !== undefined ? { previousAttachmentType } : {}),
    previousSummary: compact([
      previousType,
      previousSubtype,
      previousAttachmentType,
      entry.attachment?.hookName,
      entry.attachment?.hookEvent,
      entry.hookErrors !== undefined ? `hookErrors=${entry.hookErrors.length}` : undefined,
      entry.hasOutput !== undefined ? `hasOutput=${entry.hasOutput}` : undefined,
    ].filter(Boolean).join(' ')),
    likelyCause,
  };
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => {
    if (typeof block !== 'object' || block === null) return '';
    const typed = block as { type?: string; text?: string; content?: unknown };
    if (typed.type === 'text' && typeof typed.text === 'string') return typed.text;
    if (typed.type === 'tool_result' && typeof typed.content === 'string') return typed.content;
    return '';
  }).join('');
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item !== undefined && predicate(item)) return i;
  }
  return -1;
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240);
}

export interface JsonlTailIntegrity {
  jsonlPath: string;
  totalLines: number;
  isComplete: boolean;
  tailType?: string | undefined;
  tailSubtype?: string | undefined;
  tailLine?: number | undefined;
  tailStopReason?: string | undefined;
  lastStableAssistantLine?: number | undefined;
  danglingTypes?: string[] | undefined;
  error?: string | undefined;
}

/**
 * Check whether a JSONL transcript tail is in a consistent state.
 * A healthy tail ends with an assistant message that has stop_reason === 'end_turn'.
 * A dangling tail (e.g., tool_result without a following assistant end_turn)
 * indicates the previous query was hard-cancelled mid-turn.
 */
export function inspectJsonlTailIntegrity(
  sdkSessionId: string,
  agentCwd: string,
): JsonlTailIntegrity {
  const jsonlPath = getJsonlPath(sdkSessionId, agentCwd);
  if (!fs.existsSync(jsonlPath)) {
    return { jsonlPath, totalLines: 0, isComplete: true };
  }

  let lines: string[];
  try {
    lines = fs.readFileSync(jsonlPath, 'utf8').split(/\r?\n/).filter(Boolean);
  } catch (err) {
    return { jsonlPath, totalLines: 0, isComplete: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (lines.length === 0) {
    return { jsonlPath, totalLines: 0, isComplete: true };
  }

  // Find the last assistant with end_turn (the last stable point)
  let lastStableAssistantLine: number | undefined;
  let lastStableAssistantIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; message?: { role?: string; stop_reason?: string; model?: string } };
      if (
        entry.type === 'assistant' &&
        entry.message?.stop_reason === 'end_turn' &&
        entry.message?.model !== '<synthetic>'
      ) {
        lastStableAssistantLine = i + 1;
        lastStableAssistantIndex = i;
        break;
      }
    } catch { /* skip unparseable lines */ }
  }

  // Parse the last line to see what the tail is
  let tailEntry: { type?: string; subtype?: string; message?: { role?: string; stop_reason?: string } } | undefined;
  const lastLine = lines[lines.length - 1];
  try {
    tailEntry = lastLine !== undefined ? JSON.parse(lastLine) as typeof tailEntry : undefined;
  } catch { /* skip */ }

  const isComplete =
    tailEntry?.type === 'assistant' &&
    tailEntry?.message?.stop_reason === 'end_turn';

  // Collect dangling types after the last stable assistant
  const danglingTypes: string[] = [];
  if (lastStableAssistantIndex >= 0 && lastStableAssistantIndex < lines.length - 1) {
    for (let i = lastStableAssistantIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      try {
        const entry = JSON.parse(line) as { type?: string; subtype?: string };
        danglingTypes.push(entry.type ?? 'unknown');
      } catch { danglingTypes.push('unparseable'); }
    }
  }

  return {
    jsonlPath,
    totalLines: lines.length,
    isComplete,
    tailType: tailEntry?.type,
    tailSubtype: tailEntry?.subtype,
    tailLine: lines.length,
    tailStopReason: tailEntry?.message?.stop_reason,
    lastStableAssistantLine,
    ...(danglingTypes.length > 0 ? { danglingTypes } : {}),
  };
}
