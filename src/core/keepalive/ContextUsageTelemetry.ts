import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import { logger } from '../../utils/logger.js';

const contextUsageLogger = logger.child({ module: 'ContextUsageTelemetry' });
const DEFAULT_CONTEXT_USAGE_TIMEOUT_MS = 2_000;

type ContextUsageProvider = {
  getContextUsage?: () => Promise<SDKControlGetContextUsageResponse>;
  query?: {
    getContextUsage?: () => Promise<SDKControlGetContextUsageResponse>;
  };
};

export interface ContextUsageSnapshot {
  totalTokens: number;
  maxTokens: number;
  rawMaxTokens: number;
  percentage: number;
  model: string;
  categories: Array<{ name: string; tokens: number; isDeferred?: boolean }>;
  memoryFiles: Array<{ path: string; type: string; tokens: number }>;
  mcpTools: Array<{ name: string; serverName: string; tokens: number; isLoaded?: boolean }>;
  deferredBuiltinTools?: Array<{ name: string; tokens: number; isLoaded: boolean }>;
  systemTools?: Array<{ name: string; tokens: number }>;
  systemPromptSections?: Array<{ name: string; tokens: number }>;
  agents: Array<{ agentType: string; source: string; tokens: number }>;
  slashCommands?: { totalCommands: number; includedCommands: number; tokens: number };
  skills?: {
    totalSkills: number;
    includedSkills: number;
    tokens: number;
    skillFrontmatter: Array<{ name: string; source: string; tokens: number }>;
  };
  messageBreakdown?: {
    toolCallTokens: number;
    toolResultTokens: number;
    attachmentTokens: number;
    assistantMessageTokens: number;
    userMessageTokens: number;
    redirectedContextTokens: number;
    unattributedTokens: number;
    toolCallsByType: Array<{ name: string; callTokens: number; resultTokens: number }>;
    attachmentsByType: Array<{ name: string; tokens: number }>;
  };
  apiUsage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  } | null;
}

function sortByTokensDesc<T extends { tokens: number }>(items: T[] | undefined): T[] {
  return [...(items ?? [])].sort((a, b) => b.tokens - a.tokens);
}

function compactContextUsage(raw: SDKControlGetContextUsageResponse): ContextUsageSnapshot {
  const snapshot: ContextUsageSnapshot = {
    totalTokens: raw.totalTokens,
    maxTokens: raw.maxTokens,
    rawMaxTokens: raw.rawMaxTokens,
    percentage: raw.percentage,
    model: raw.model,
    categories: sortByTokensDesc(raw.categories).map((item) => ({
      name: item.name,
      tokens: item.tokens,
      ...(item.isDeferred !== undefined ? { isDeferred: item.isDeferred } : {}),
    })),
    memoryFiles: sortByTokensDesc(raw.memoryFiles).map((item) => ({
      path: item.path,
      type: item.type,
      tokens: item.tokens,
    })),
    mcpTools: sortByTokensDesc(raw.mcpTools).map((item) => ({
      name: item.name,
      serverName: item.serverName,
      tokens: item.tokens,
      ...(item.isLoaded !== undefined ? { isLoaded: item.isLoaded } : {}),
    })),
    agents: sortByTokensDesc(raw.agents).map((item) => ({
      agentType: item.agentType,
      source: item.source,
      tokens: item.tokens,
    })),
    apiUsage: raw.apiUsage,
  };

  if (raw.deferredBuiltinTools !== undefined) {
    snapshot.deferredBuiltinTools = sortByTokensDesc(raw.deferredBuiltinTools).map((item) => ({
      name: item.name,
      tokens: item.tokens,
      isLoaded: item.isLoaded,
    }));
  }
  if (raw.systemTools !== undefined) {
    snapshot.systemTools = sortByTokensDesc(raw.systemTools).map((item) => ({
      name: item.name,
      tokens: item.tokens,
    }));
  }
  if (raw.systemPromptSections !== undefined) {
    snapshot.systemPromptSections = sortByTokensDesc(raw.systemPromptSections).map((item) => ({
      name: item.name,
      tokens: item.tokens,
    }));
  }
  if (raw.slashCommands !== undefined) {
    snapshot.slashCommands = raw.slashCommands;
  }
  if (raw.skills !== undefined) {
    snapshot.skills = {
      totalSkills: raw.skills.totalSkills,
      includedSkills: raw.skills.includedSkills,
      tokens: raw.skills.tokens,
      skillFrontmatter: sortByTokensDesc(raw.skills.skillFrontmatter).map((item) => ({
        name: item.name,
        source: item.source,
        tokens: item.tokens,
      })),
    };
  }
  if (raw.messageBreakdown !== undefined) {
    snapshot.messageBreakdown = {
      toolCallTokens: raw.messageBreakdown.toolCallTokens,
      toolResultTokens: raw.messageBreakdown.toolResultTokens,
      attachmentTokens: raw.messageBreakdown.attachmentTokens,
      assistantMessageTokens: raw.messageBreakdown.assistantMessageTokens,
      userMessageTokens: raw.messageBreakdown.userMessageTokens,
      redirectedContextTokens: raw.messageBreakdown.redirectedContextTokens,
      unattributedTokens: raw.messageBreakdown.unattributedTokens,
      toolCallsByType: sortByTokensDesc(
        raw.messageBreakdown.toolCallsByType.map((item) => ({
          ...item,
          tokens: item.callTokens + item.resultTokens,
        }))
      ).map(({ tokens: _tokens, ...item }) => item),
      attachmentsByType: sortByTokensDesc(raw.messageBreakdown.attachmentsByType),
    };
  }

  return snapshot;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`getContextUsage timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function resolveContextUsageProvider(session: unknown): (() => Promise<SDKControlGetContextUsageResponse>) | undefined {
  const provider = session as ContextUsageProvider;
  if (typeof provider.getContextUsage === 'function') return provider.getContextUsage.bind(provider);
  if (typeof provider.query?.getContextUsage === 'function') {
    return provider.query.getContextUsage.bind(provider.query);
  }
  return undefined;
}

export async function collectContextUsageSnapshot(
  sessionId: string,
  session: unknown,
  timeoutMs = DEFAULT_CONTEXT_USAGE_TIMEOUT_MS,
): Promise<ContextUsageSnapshot | undefined> {
  const getContextUsage = resolveContextUsageProvider(session);
  if (getContextUsage === undefined) return undefined;

  try {
    const raw = await withTimeout(getContextUsage(), timeoutMs);
    const snapshot = compactContextUsage(raw);
    contextUsageLogger.info(
      {
        sessionId,
        event_type: 'sdk.context_usage_snapshot',
        totalTokens: snapshot.totalTokens,
        maxTokens: snapshot.maxTokens,
        percentage: snapshot.percentage,
        model: snapshot.model,
        topCategories: snapshot.categories.slice(0, 8),
        topMcpTools: snapshot.mcpTools.slice(0, 8),
        topSystemPromptSections: snapshot.systemPromptSections?.slice(0, 8),
        skillsTokens: snapshot.skills?.tokens,
        includedSkills: snapshot.skills?.includedSkills,
        messageBreakdown: snapshot.messageBreakdown,
      },
      'SDK context usage snapshot'
    );
    return snapshot;
  } catch (error) {
    contextUsageLogger.warn(
      { sessionId, err: error instanceof Error ? error.message : String(error) },
      'Failed to collect SDK context usage snapshot'
    );
    return undefined;
  }
}
