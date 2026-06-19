interface HookInputRecord {
  readonly [key: string]: unknown;
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

function extractHookToolInput(input: unknown): Record<string, unknown> | undefined {
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
