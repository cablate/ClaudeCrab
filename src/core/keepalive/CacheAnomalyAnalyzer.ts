/**
 * CacheAnomalyAnalyzer — pure analysis logic for JSONL cache invalidation detection.
 *
 * Zero side effects, zero Discord/DB dependency. Consumed by:
 *   - scripts/trace-cache-anomaly.ts (CLI)
 *   - DiscordCacheAnomalyReport (daily Embed)
 *   - (future) per-turn realtime alert in SDKStreamProcessor
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { projectHash } from '../lib/JsonlSanitizer.js';

// ─── Public Types ───────────────────────────────────────────────────────────

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

// ─── JSONL Parsing ──────────────────────────────────────────────────────────

export function parseJsonl(filePath: string): JsonlEntry[] {
  let content: string;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return []; }
  const lines = content.split(/\r?\n/).filter(Boolean);
  const entries: JsonlEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i]!) as Omit<JsonlEntry, 'line'>;
      entries.push({ ...parsed, line: i + 1 });
    } catch {
      entries.push({ line: i + 1, type: 'unparseable' });
    }
  }
  return entries;
}

// ─── Anomaly Detection ──────────────────────────────────────────────────────

export function detectAnomaly(m: {
  inputTokens: number;
  cacheRead: number;
  cacheCreation: number;
}): AnomalyType | null {
  if (m.cacheCreation >= 50_000) return 'creation_spike';
  if (m.inputTokens <= 200 && m.cacheCreation >= 25_000) return 'tiny_input_huge_write';
  const total = m.cacheRead + m.cacheCreation + m.inputTokens;
  if (m.cacheRead <= 20_000 && m.cacheCreation >= 50_000) return 'read_collapse';
  if (total > 0 && m.cacheCreation / total >= 0.30 && m.cacheCreation >= 25_000) return 'high_create_ratio';
  return null;
}

// ─── Cause Identification ───────────────────────────────────────────────────

export function identifyCause(
  entries: JsonlEntry[],
  assistantIndex: number,
  detectedTTLMs?: number,
): { cause: CauseLabel; detail?: string | undefined; causeLine?: number | undefined } {
  const currentTs = entries[assistantIndex]?.timestamp;

  // Find previous assistant turn for gap/context diagnostics
  let prevAssistantIndex = -1;
  let prevAssistantTs: string | undefined;
  let prevCacheRead = 0;
  let gapMs = 0;
  for (let i = assistantIndex - 1; i >= 0; i--) {
    const prev = entries[i]!;
    if (prev.type === 'assistant' && prev.timestamp) {
      prevAssistantIndex = i;
      prevAssistantTs = prev.timestamp;
      prevCacheRead = prev.message?.usage?.cache_read_input_tokens ?? 0;
      if (currentTs) gapMs = new Date(currentTs).getTime() - new Date(prevAssistantTs).getTime();
      break;
    }
  }

  // 0. Prefix rebuild — cache_read collapsed to near-baseline regardless of gap
  const SYSTEM_PROMPT_BASELINE = 15_000;
  const currentCacheRead = entries[assistantIndex]?.message?.usage?.cache_read_input_tokens ?? 0;
  if (prevCacheRead > 50_000 && currentCacheRead <= SYSTEM_PROMPT_BASELINE) {
    return {
      cause: 'prefix_rebuild',
      detail: `read_collapsed ${prevCacheRead}→${currentCacheRead} gap=${Math.round(gapMs / 1000)}s`,
    };
  }

  // 1. TTL expiry (gap exceeds detected or default TTL)
  const effectiveTTLMs = detectedTTLMs ?? 5 * 60 * 1000;
  if (gapMs > effectiveTTLMs) {
    return { cause: 'ttl_expiry', detail: `${Math.round(gapMs / 60_000)}min gap (TTL=${Math.round(effectiveTTLMs / 60_000)}min)` };
  }

  // 2. Known attachment/system causes — scan backwards from anomaly turn
  let nonAssistantSeen = 0;
  for (let i = assistantIndex - 1; i >= Math.max(0, assistantIndex - 30); i--) {
    const entry = entries[i]!;
    if (entry.type === 'assistant') continue;
    nonAssistantSeen++;
    if (nonAssistantSeen > 10) break;

    if (entry.type === 'system' && entry.subtype === 'stop_hook_summary') {
      const hookError = entry.hookErrors?.[0];
      return {
        cause: 'stop_hook_summary',
        detail: hookError ? hookError.slice(0, 120) : `hasOutput=${entry.hasOutput}`,
        causeLine: entry.line,
      };
    }

    if (entry.type === 'attachment') {
      const aType = entry.attachment?.type;
      if (aType === 'hook_blocking_error')
        return { cause: 'hook_blocking_error', detail: entry.attachment?.hookName ?? entry.attachment?.hookEvent, causeLine: entry.line };
      if (aType === 'todo_reminder')
        return { cause: 'todo_reminder', detail: `itemCount=${Array.isArray(entry.attachment?.content) ? entry.attachment.content.length : '?'}`, causeLine: entry.line };
      if (aType === 'task_reminder')
        return { cause: 'task_reminder', detail: `itemCount=${Array.isArray(entry.attachment?.content) ? entry.attachment.content.length : '?'}`, causeLine: entry.line };
      if (aType === 'mcp_instructions_delta')
        return { cause: 'mcp_instructions_delta', detail: entry.attachment?.hookName, causeLine: entry.line };
      if (aType === 'deferred_tools_delta')
        return { cause: 'deferred_tools_delta', detail: entry.attachment?.hookName, causeLine: entry.line };
      if (aType === 'hook_additional_context')
        return { cause: 'hook_additional_context', detail: entry.attachment?.hookName ?? entry.attachment?.hookEvent, causeLine: entry.line };
    }

    if (entry.type === 'system' && entry.subtype && !['init', 'login'].includes(entry.subtype)) {
      return { cause: 'dynamic_system_reminder', detail: entry.subtype, causeLine: entry.line };
    }
  }

  // 3. Batch tool_results — many tool_result messages between adjacent assistant turns
  if (prevAssistantIndex >= 0) {
    let toolResultCount = 0;
    for (let i = prevAssistantIndex + 1; i < assistantIndex; i++) {
      const entry = entries[i]!;
      if (entry.type !== 'user') continue;
      const content = entry.message?.content;
      if (Array.isArray(content) && (content as { type?: string }[]).some(b => b.type === 'tool_result')) {
        toolResultCount++;
      }
    }
    if (toolResultCount >= 8) {
      return { cause: 'batch_tool_results', detail: `${toolResultCount} tool_results between turns` };
    }
  }

  // 4. Near-TTL gap (3–5 min) — server-side eviction before TTL expiry
  if (gapMs >= 3 * 60 * 1000) {
    return { cause: 'near_ttl_gap', detail: `${Math.round(gapMs / 1000)}s gap (near TTL boundary)` };
  }

  // 5. Unknown — enrich detail with diagnostics for manual investigation
  const diag: string[] = [];
  if (prevAssistantIndex >= 0) {
    const msgsBetween = assistantIndex - prevAssistantIndex - 1;
    diag.push(`msgs=${msgsBetween}`);
    diag.push(`prev_read=${prevCacheRead}`);
  }
  if (gapMs > 0) diag.push(`gap=${Math.round(gapMs / 1000)}s`);
  return { cause: 'unknown_prefix_rebuild', detail: diag.join(' ') || undefined };
}

// ─── Analyze a Single JSONL ─────────────────────────────────────────────────

export function analyzeJsonl(filePath: string): ScanResult {
  const entries = parseJsonl(filePath);
  const turns: TurnMetrics[] = [];
  let lastUsageKey = '';

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.type !== 'assistant') continue;
    const usage = entry.message?.usage;
    if (!usage) continue;

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

    let cause: CauseLabel | null = null;
    let causeDetail: string | undefined;
    let causeLine: number | undefined;
    if (anomaly) {
      const identified = identifyCause(entries, i);
      cause = identified.cause;
      causeDetail = identified.detail;
      causeLine = identified.causeLine;
    }

    const contentText = extractContentText(entry.message?.content);
    const displayType = contentText === 'ok' ? 'keepalive' :
      contentText.length <= 50 ? 'short_reply' : 'normal';

    turns.push({
      line: entry.line,
      timestamp: entry.timestamp,
      type: displayType,
      subtype: entry.subtype,
      inputTokens, cacheRead, cacheCreation, outputTokens,
      totalContext, hitPct, anomaly, cause, causeDetail, causeLine,
    });
  }

  const anomalies = turns.filter(t => t.anomaly !== null);
  const totalCacheCreation = turns.reduce((sum, t) => sum + t.cacheCreation, 0);
  const totalCacheRead = turns.reduce((sum, t) => sum + t.cacheRead, 0);
  const worstTurn = anomalies.length > 0
    ? anomalies.reduce((worst, t) => t.cacheCreation > worst.cacheCreation ? t : worst, anomalies[0]!)
    : null;

  return { file: filePath, totalTurns: turns.length, anomalies, totalCacheCreation, totalCacheRead, worstTurn };
}

// ─── Scan Today's JSONL Files ───────────────────────────────────────────────

export function scanRecentJsonlFiles(options?: { since?: string; top?: number }): ScanResult[] {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeDir)) return [];

  const sinceMs = options?.since ? new Date(options.since).getTime() : 0;
  const top = options?.top ?? 50;

  const jsonlFiles: { path: string; mtime: number }[] = [];
  const projectDirs = fs.readdirSync(claudeDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(claudeDir, d.name));

  for (const dir of projectDirs) {
    try {
      for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
        const fullPath = path.join(dir, f);
        const stat = fs.statSync(fullPath);
        if (sinceMs && stat.mtimeMs < sinceMs) continue;
        jsonlFiles.push({ path: fullPath, mtime: stat.mtimeMs });
      }
    } catch { /* skip unreadable dirs */ }
  }

  jsonlFiles.sort((a, b) => b.mtime - a.mtime);

  const results: ScanResult[] = [];
  for (const { path: fp } of jsonlFiles.slice(0, top)) {
    try {
      const result = analyzeJsonl(fp);
      if (result.anomalies.length > 0) results.push(result);
    } catch { /* skip unparseable files */ }
  }

  results.sort((a, b) => (b.worstTurn?.cacheCreation ?? 0) - (a.worstTurn?.cacheCreation ?? 0));
  return results;
}

// ─── Session ID → JSONL Path ────────────────────────────────────────────────

export function getJsonlPathForAgent(sdkSessionId: string, agentCwd: string): string {
  return path.join(os.homedir(), '.claude', 'projects', projectHash(agentCwd), `${sdkSessionId}.jsonl`);
}

// ─── Per-Turn Realtime Analysis ─────────────────────────────────────────────

export interface CurrentTurnUsage {
  input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  output_tokens: number;
}

/**
 * Analyze a single turn from live SDK stream data.
 * Called by SDKStreamProcessor on every assistant message with usage.
 *
 * If no anomaly → returns null (fast path, no I/O).
 * If anomaly detected → reads JSONL tail to identify cause.
 */
export function analyzeCurrentTurn(
  usage: CurrentTurnUsage,
  jsonlPath: string,
  detectedTTLMs?: number,
): TurnMetrics | null {
  const inputTokens = usage.input_tokens;
  const cacheRead = usage.cache_read_input_tokens;
  const cacheCreation = usage.cache_creation_input_tokens;
  const outputTokens = usage.output_tokens;
  const totalContext = inputTokens + cacheRead + cacheCreation;
  const hitPct = totalContext > 0 ? Math.round((cacheRead / totalContext) * 100) : 0;

  const anomaly = detectAnomaly({ inputTokens, cacheRead, cacheCreation });
  if (anomaly === null) return null;

  // Anomaly detected — read JSONL tail to identify cause.
  let cause: CauseLabel = 'unknown_prefix_rebuild';
  let causeDetail: string | undefined;
  let causeLine: number | undefined;
  let line = 0;

  try {
    if (fs.existsSync(jsonlPath)) {
      const entries = parseJsonlTail(jsonlPath, 40);
      if (entries.length > 0) {
        line = entries[entries.length - 1]!.line;
        // Find the last assistant entry in the tail (likely the current one)
        let assistantIdx = entries.length - 1;
        for (let i = entries.length - 1; i >= 0; i--) {
          if (entries[i]!.type === 'assistant') { assistantIdx = i; break; }
        }
        const identified = identifyCause(entries, assistantIdx, detectedTTLMs);
        cause = identified.cause;
        causeDetail = identified.detail;
        causeLine = identified.causeLine;
      }
    }
  } catch { /* cause identification is best-effort */ }

  return {
    line,
    type: 'realtime',
    inputTokens, cacheRead, cacheCreation, outputTokens,
    totalContext, hitPct, anomaly, cause, causeDetail, causeLine,
  };
}

/**
 * Read only the last N lines of a JSONL file.
 * Avoids reading the entire file for realtime checks.
 */
function parseJsonlTail(filePath: string, tailLines: number): JsonlEntry[] {
  let content: string;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return []; }
  const allLines = content.split(/\r?\n/).filter(Boolean);
  const startIdx = Math.max(0, allLines.length - tailLines);
  const entries: JsonlEntry[] = [];
  for (let i = startIdx; i < allLines.length; i++) {
    try {
      const parsed = JSON.parse(allLines[i]!) as Omit<JsonlEntry, 'line'>;
      entries.push({ ...parsed, line: i + 1 });
    } catch {
      entries.push({ line: i + 1, type: 'unparseable' });
    }
  }
  return entries;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b: unknown) => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text')
    .map((b: unknown) => ((b as { text?: string }).text ?? ''))
    .join('');
}
