interface HookInputRecord {
  readonly [key: string]: unknown;
}

interface BashToolResponseText {
  readonly stdout: string;
  readonly stderr: string;
  readonly combined: string;
  readonly hasToolResponse: boolean;
}

interface ToolResponseTextStats {
  readonly charCount: number;
  readonly hasToolResponse: boolean;
}

interface HookAgentContext {
  /** SDK subagent identifier. Present only when the hook fires inside a subagent. */
  readonly agentId?: string;
  /** Agent type/name. Can appear on main-thread --agent sessions, so do not use alone. */
  readonly agentType?: string;
  readonly isSubagent: boolean;
}

interface HookReadInputSummary {
  readonly filePath?: string;
  readonly bounded: boolean;
}

function asRecord(value: unknown): HookInputRecord | undefined {
  return value !== null && typeof value === 'object' ? value as HookInputRecord : undefined;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function collectStringLengths(value: unknown, depth = 0): number {
  if (depth > 6 || value === null || value === undefined) return 0;
  if (typeof value === 'string') return value.length;
  if (typeof value !== 'object') return 0;
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + collectStringLengths(item, depth + 1), 0);
  }

  let total = 0;
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (['filePath', 'file_path', 'url', 'source', 'path'].includes(key)) continue;
    total += collectStringLengths(nestedValue, depth + 1);
  }
  return total;
}

export function extractBashToolResponseText(input: unknown): BashToolResponseText {
  const payload = asRecord(input);
  const response = asRecord(payload?.tool_response);
  const stdout = asString(response?.stdout);
  const stderr = asString(response?.stderr);
  const combined = [stdout, stderr].filter(Boolean).join('\n');

  return {
    stdout,
    stderr,
    combined,
    hasToolResponse: response !== undefined,
  };
}

export function extractToolResponseTextStats(input: unknown): ToolResponseTextStats {
  const payload = asRecord(input);
  const response = payload?.tool_response;

  return {
    charCount: collectStringLengths(response),
    hasToolResponse: response !== undefined,
  };
}

export function extractHookErrorText(input: unknown): string {
  return asString(asRecord(input)?.error);
}

export function isHookInterrupt(input: unknown): boolean {
  return asRecord(input)?.is_interrupt === true;
}

export function extractHookToolInput(input: unknown): Record<string, unknown> | undefined {
  const toolInput = asRecord(input)?.tool_input;
  return toolInput !== undefined ? { ...toolInput } : undefined;
}

export function extractHookReadInput(input: unknown): HookReadInputSummary {
  const toolInput = extractHookToolInput(input);
  const rawPath = toolInput?.file_path ?? toolInput?.filePath ?? toolInput?.path;
  const filePath = typeof rawPath === 'string' && rawPath.trim().length > 0
    ? rawPath.trim()
    : undefined;
  const bounded = toolInput !== undefined && (
    toolInput.offset !== undefined ||
    toolInput.limit !== undefined
  );

  return {
    ...(filePath !== undefined ? { filePath } : {}),
    bounded,
  };
}

export function extractHookAgentContext(input: unknown): HookAgentContext {
  const payload = asRecord(input);
  const agentId = asString(payload?.agent_id);
  const agentType = asString(payload?.agent_type);

  return {
    ...(agentId.length > 0 ? { agentId } : {}),
    ...(agentType.length > 0 ? { agentType } : {}),
    isSubagent: agentId.length > 0,
  };
}
