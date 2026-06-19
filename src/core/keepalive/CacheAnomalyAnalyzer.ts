/**
 * Pure JSONL cache anomaly analysis for the daily ops report.
 *
 * This module has no Discord or database dependency. It scans Claude JSONL
 * transcripts, detects large cache creation events, and labels likely causes.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface JsonlEntry {
  line: number;
  type?: string;
  subtype?: string;
  uuid?: string;
  parentUuid?: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      output_tokens?: number;
      cache_creation?: {
        ephemeral_1h_input_tokens?: number;
        ephemeral_5m_input_tokens?: number;
      };
    };
    stop_reason?: string;
    model?: string;
  };
  attachment?: { type?: string; hookName?: string; hookEvent?: string; content?: unknown };
  hookErrors?: string[];
  hasOutput?: boolean;
  toolUseID?: string;
  data?: { type?: string; hookEvent?: string; hookName?: string };
}

export interface TurnMetrics {
  line: number;
  timestamp?: string | undefined;
  type: string;
  subtype?: string | undefined;
  inputTokens: number;
  cacheRead: number;
  cacheCreation: number;
  outputTokens: number;
  totalContext: number;
  hitPct: number;
  anomaly: AnomalyType | null;
  cause: CauseLabel | null;
  causeDetail?: string | undefined;
  causeLine?: number | undefined;
}

export type AnomalyType =
  | 'creation_spike'
  | 'tiny_input_huge_write'
  | 'read_collapse'
  | 'high_create_ratio';

export type CauseLabel =
  | 'stop_hook_summary'
  | 'hook_blocking_error'
  | 'todo_reminder'
  | 'task_reminder'
  | 'mcp_instructions_delta'
  | 'deferred_tools_delta'
  | 'hook_additional_context'
  | 'dynamic_system_reminder'
  | 'prefix_rebuild'
  | 'ttl_expiry'
  | 'batch_tool_results'
  | 'near_ttl_gap'
  | 'unknown_prefix_rebuild';

export interface ScanResult {
  file: string;
  totalTurns: number;
  anomalies: TurnMetrics[];
  totalCacheCreation: number;
  totalCacheRead: number;
  worstTurn: TurnMetrics | null;
}

interface CauseResult {
  cause: CauseLabel;
  detail?: string | undefined;
  causeLine?: number | undefined;
}

export function parseJsonl(filePath: string): JsonlEntry[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  return content.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return { ...(JSON.parse(line) as Omit<JsonlEntry, 'line'>), line: index + 1 };
    } catch {
      return { line: index + 1, type: 'unparseable' };
    }
  });
}

export function detectAnomaly(metrics: {
  inputTokens: number;
  cacheRead: number;
  cacheCreation: number;
}): AnomalyType | null {
  if (metrics.cacheCreation >= 50_000) return 'creation_spike';
  if (metrics.inputTokens <= 200 && metrics.cacheCreation >= 25_000) return 'tiny_input_huge_write';
  const total = metrics.cacheRead + metrics.cacheCreation + metrics.inputTokens;
  if (metrics.cacheRead <= 20_000 && metrics.cacheCreation >= 50_000) return 'read_collapse';
  if (total > 0 && metrics.cacheCreation / total >= 0.30 && metrics.cacheCreation >= 25_000) return 'high_create_ratio';
  return null;
}

export function identifyCause(
  entries: JsonlEntry[],
  assistantIndex: number,
  detectedTTLMs?: number,
): CauseResult {
  const currentTs = entries[assistantIndex]?.timestamp;
  const previous = findPreviousAssistant(entries, assistantIndex, currentTs);
  const currentCacheRead = entries[assistantIndex]?.message?.usage?.cache_read_input_tokens ?? 0;

  if (previous.cacheRead > 50_000 && currentCacheRead <= 15_000) {
    return {
      cause: 'prefix_rebuild',
      detail: `read_collapsed ${previous.cacheRead}->${currentCacheRead} gap=${Math.round(previous.gapMs / 1000)}s`,
    };
  }

  const effectiveTTLMs = detectedTTLMs ?? 5 * 60 * 1000;
  if (previous.gapMs > effectiveTTLMs) {
    return {
      cause: 'ttl_expiry',
      detail: `${Math.round(previous.gapMs / 60_000)}min gap (TTL=${Math.round(effectiveTTLMs / 60_000)}min)`,
    };
  }

  const knownCause = findKnownCause(entries, assistantIndex);
  if (knownCause !== null) return knownCause;

  if (previous.index >= 0) {
    const toolResultCount = countToolResultsBetween(entries, previous.index, assistantIndex);
    if (toolResultCount >= 8) {
      return { cause: 'batch_tool_results', detail: `${toolResultCount} tool_results between turns` };
    }
  }

  if (previous.gapMs >= 3 * 60 * 1000) {
    return { cause: 'near_ttl_gap', detail: `${Math.round(previous.gapMs / 1000)}s gap (near TTL boundary)` };
  }

  const details = [
    previous.index >= 0 ? `msgs=${assistantIndex - previous.index - 1}` : undefined,
    previous.index >= 0 ? `prev_read=${previous.cacheRead}` : undefined,
    previous.gapMs > 0 ? `gap=${Math.round(previous.gapMs / 1000)}s` : undefined,
  ].filter((item): item is string => item !== undefined);
  return { cause: 'unknown_prefix_rebuild', detail: details.join(' ') || undefined };
}

export function analyzeJsonl(filePath: string): ScanResult {
  const entries = parseJsonl(filePath);
  const turns: TurnMetrics[] = [];
  let lastUsageKey = '';

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === undefined || entry.type !== 'assistant') continue;
    const usage = entry.message?.usage;
    if (usage === undefined) continue;

    const inputTokens = usage.input_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheCreation = usage.cache_creation_input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;

    const usageKey = `${inputTokens}:${cacheRead}:${cacheCreation}:${outputTokens}`;
    if (usageKey === lastUsageKey) continue;
    lastUsageKey = usageKey;

    const totalContext = inputTokens + cacheRead + cacheCreation;
    const hitPct = totalContext > 0 ? Math.round((cacheRead / totalContext) * 100) : 0;
    const anomaly = detectAnomaly({ inputTokens, cacheRead, cacheCreation });
    const cause = anomaly !== null ? identifyCause(entries, i) : null;
    const contentText = extractContentText(entry.message?.content);

    turns.push({
      line: entry.line,
      timestamp: entry.timestamp,
      type: contentText === 'ok' ? 'keepalive' : contentText.length <= 50 ? 'short_reply' : 'normal',
      subtype: entry.subtype,
      inputTokens,
      cacheRead,
      cacheCreation,
      outputTokens,
      totalContext,
      hitPct,
      anomaly,
      cause: cause?.cause ?? null,
      causeDetail: cause?.detail,
      causeLine: cause?.causeLine,
    });
  }

  const anomalies = turns.filter((turn) => turn.anomaly !== null);
  const totalCacheCreation = turns.reduce((sum, turn) => sum + turn.cacheCreation, 0);
  const totalCacheRead = turns.reduce((sum, turn) => sum + turn.cacheRead, 0);
  const [firstAnomaly, ...remainingAnomalies] = anomalies;
  const worstTurn = firstAnomaly !== undefined
    ? remainingAnomalies.reduce((worst, turn) => turn.cacheCreation > worst.cacheCreation ? turn : worst, firstAnomaly)
    : null;

  return { file: filePath, totalTurns: turns.length, anomalies, totalCacheCreation, totalCacheRead, worstTurn };
}

export function scanRecentJsonlFiles(options?: { since?: string; top?: number }): ScanResult[] {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeDir)) return [];

  const sinceMs = options?.since ? new Date(options.since).getTime() : 0;
  const top = options?.top ?? 50;
  const jsonlFiles = findRecentJsonlFiles(claudeDir, sinceMs).slice(0, top);

  const results: ScanResult[] = [];
  for (const filePath of jsonlFiles) {
    try {
      const result = analyzeJsonl(filePath);
      if (result.anomalies.length > 0) results.push(result);
    } catch {
      // Ignore individual corrupt transcripts. This report is best-effort.
    }
  }

  return results.sort((a, b) => (b.worstTurn?.cacheCreation ?? 0) - (a.worstTurn?.cacheCreation ?? 0));
}

export function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block: unknown) => typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text')
    .map((block: unknown) => ((block as { text?: string }).text ?? ''))
    .join('');
}

function findPreviousAssistant(
  entries: JsonlEntry[],
  assistantIndex: number,
  currentTs: string | undefined,
): { index: number; cacheRead: number; gapMs: number } {
  for (let i = assistantIndex - 1; i >= 0; i--) {
    const previous = entries[i];
    if (previous?.type !== 'assistant' || previous.timestamp === undefined) continue;
    const gapMs = currentTs !== undefined
      ? new Date(currentTs).getTime() - new Date(previous.timestamp).getTime()
      : 0;
    return {
      index: i,
      cacheRead: previous.message?.usage?.cache_read_input_tokens ?? 0,
      gapMs,
    };
  }
  return { index: -1, cacheRead: 0, gapMs: 0 };
}

function findKnownCause(entries: JsonlEntry[], assistantIndex: number): CauseResult | null {
  let nonAssistantSeen = 0;
  for (let i = assistantIndex - 1; i >= Math.max(0, assistantIndex - 30); i--) {
    const entry = entries[i];
    if (entry === undefined || entry.type === 'assistant') continue;
    nonAssistantSeen++;
    if (nonAssistantSeen > 10) break;

    const systemCause = identifySystemCause(entry);
    if (systemCause !== null) return systemCause;

    const attachmentCause = identifyAttachmentCause(entry);
    if (attachmentCause !== null) return attachmentCause;
  }
  return null;
}

function identifySystemCause(entry: JsonlEntry): CauseResult | null {
  if (entry.type === 'system' && entry.subtype === 'stop_hook_summary') {
    const hookError = entry.hookErrors?.[0];
    return {
      cause: 'stop_hook_summary',
      detail: hookError ? hookError.slice(0, 120) : `hasOutput=${entry.hasOutput}`,
      causeLine: entry.line,
    };
  }

  if (entry.type === 'system' && entry.subtype !== undefined && !['init', 'login'].includes(entry.subtype)) {
    return { cause: 'dynamic_system_reminder', detail: entry.subtype, causeLine: entry.line };
  }

  return null;
}

function identifyAttachmentCause(entry: JsonlEntry): CauseResult | null {
  if (entry.type !== 'attachment') return null;

  const detail = entry.attachment?.hookName ?? entry.attachment?.hookEvent;
  switch (entry.attachment?.type) {
    case 'hook_blocking_error':
      return { cause: 'hook_blocking_error', detail, causeLine: entry.line };
    case 'todo_reminder':
      return { cause: 'todo_reminder', detail: `itemCount=${arrayLength(entry.attachment.content)}`, causeLine: entry.line };
    case 'task_reminder':
      return { cause: 'task_reminder', detail: `itemCount=${arrayLength(entry.attachment.content)}`, causeLine: entry.line };
    case 'mcp_instructions_delta':
      return { cause: 'mcp_instructions_delta', detail: entry.attachment.hookName, causeLine: entry.line };
    case 'deferred_tools_delta':
      return { cause: 'deferred_tools_delta', detail: entry.attachment.hookName, causeLine: entry.line };
    case 'hook_additional_context':
      return { cause: 'hook_additional_context', detail, causeLine: entry.line };
    default:
      return null;
  }
}

function countToolResultsBetween(entries: JsonlEntry[], fromAssistantIndex: number, toAssistantIndex: number): number {
  let count = 0;
  for (let i = fromAssistantIndex + 1; i < toAssistantIndex; i++) {
    const entry = entries[i];
    if (entry?.type !== 'user') continue;
    const content = entry.message?.content;
    if (Array.isArray(content) && (content as { type?: string }[]).some((block) => block.type === 'tool_result')) {
      count++;
    }
  }
  return count;
}

function findRecentJsonlFiles(claudeDir: string, sinceMs: number): string[] {
  const files: { path: string; mtime: number }[] = [];
  const projectDirs = fs.readdirSync(claudeDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => path.join(claudeDir, dirent.name));

  for (const dir of projectDirs) {
    try {
      for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl'))) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (sinceMs !== 0 && stat.mtimeMs < sinceMs) continue;
        files.push({ path: fullPath, mtime: stat.mtimeMs });
      }
    } catch {
      // Ignore unreadable project dirs.
    }
  }

  return files.sort((a, b) => b.mtime - a.mtime).map((file) => file.path);
}

function arrayLength(value: unknown): number | '?' {
  return Array.isArray(value) ? value.length : '?';
}
