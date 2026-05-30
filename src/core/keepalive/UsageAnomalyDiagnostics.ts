import type { QueryResult, QueryUsage, QueryModelUsage } from '../query/SDKQueryManager.js';

export type UsageAnomalySeverity = 'info' | 'warn';

export type UsageAnomalyCode =
  | 'large_initial_cache_write'
  | 'resumed_cache_cold_start'
  | 'resumed_cache_partial_rewrite'
  | 'large_cache_creation'
  | 'huge_cache_creation';

export interface UsageAnomalyContext {
  sessionId?: string;
  sdkSessionId?: string;
  agentId?: string;
  chatId?: string;
  userId?: string;
  cwd?: string;
  queryMetricId?: number;
  discordUrl?: string;
  sourceMessageUrl?: string;
  jsonlPath?: string;
  sessionMessageCount?: number;
  hasResume?: boolean;
  promptCacheMutation?: {
    reason: string;
    at: number;
    detail?: string;
  };
}

export interface UsageAnomalyFinding {
  code: UsageAnomalyCode;
  severity: UsageAnomalySeverity;
  title: string;
  detail: string;
  alert: boolean;
}

export interface UsageAnomalyMetrics {
  freshInputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalInputTokens: number;
  cacheHitPct: number;
  cacheWritePct: number;
  costUsd: number;
  numTurns: number;
}

export interface UsageAnomalyModelMetrics extends UsageAnomalyMetrics {
  model: string;
  webSearchRequests: number;
}

export interface UsageAnomalyReport {
  severity: UsageAnomalySeverity;
  shouldAlert: boolean;
  activityType: 'session.cache_bust';
  title: string;
  message: string;
  details: string;
  likelyCause: string;
  findings: UsageAnomalyFinding[];
  metrics: UsageAnomalyMetrics;
  modelBreakdown?: UsageAnomalyModelMetrics[];
  links?: Array<{ label: string; url: string }>;
}

const LARGE_CACHE_CREATION_TOKENS = 50_000;
const HUGE_CACHE_CREATION_TOKENS = 100_000;
const RESUMED_CACHE_COLD_START_TOKENS = 25_000;
const LOW_CACHE_HIT_PCT = 50;

export interface MainSubagentSplit {
  main: UsageAnomalyMetrics;
  subagent: UsageAnomalyMetrics;
  mainModel?: string | undefined;
}

/**
 * Split modelUsage into main-session vs subagent metrics.
 * When knownMainModel is provided, use it directly.
 * Otherwise fall back to heuristic: highest cacheReadInputTokens = main.
 */
export function splitMainSubagentUsage(
  modelUsage: Record<string, QueryModelUsage> | undefined,
  knownMainModel?: string,
): MainSubagentSplit | null {
  if (modelUsage === undefined) return null;
  const entries = Object.entries(modelUsage).filter(
    ([, u]) => u.inputTokens > 0 || u.outputTokens > 0 || u.cacheReadInputTokens > 0 || u.cacheCreationInputTokens > 0,
  );
  if (entries.length <= 1) return null;

  let mainModel: string | undefined;
  if (knownMainModel !== undefined) {
    // Match known model against modelUsage keys (may be resolved full ID)
    mainModel = entries.find(([m]) => m === knownMainModel)?.[0]
      ?? entries.find(([m]) => m.includes(knownMainModel) || knownMainModel.includes(m))?.[0];
  }
  if (mainModel === undefined) {
    // Fallback heuristic: highest cache read
    let maxCacheRead = -1;
    for (const [model, u] of entries) {
      if (u.cacheReadInputTokens > maxCacheRead) {
        maxCacheRead = u.cacheReadInputTokens;
        mainModel = model;
      }
    }
  }
  if (mainModel === undefined) return null;

  const mainUsage = modelUsage[mainModel]!;
  const main = getUsageAnomalyMetrics(mainUsage, mainUsage.costUsd, undefined);

  let subInput = 0, subOutput = 0, subRead = 0, subCreate = 0, subCost = 0;
  for (const [model, u] of entries) {
    if (model === mainModel) continue;
    subInput += u.inputTokens ?? 0;
    subOutput += u.outputTokens ?? 0;
    subRead += u.cacheReadInputTokens ?? 0;
    subCreate += u.cacheCreationInputTokens ?? 0;
    subCost += u.costUsd ?? 0;
  }
  const subTotal = subInput + subRead + subCreate;
  const subagent: UsageAnomalyMetrics = {
    freshInputTokens: subInput,
    outputTokens: subOutput,
    cacheReadTokens: subRead,
    cacheCreationTokens: subCreate,
    totalInputTokens: subTotal,
    cacheHitPct: subTotal > 0 ? Math.round((subRead / subTotal) * 100) : 0,
    cacheWritePct: subTotal > 0 ? Math.round((subCreate / subTotal) * 100) : 0,
    costUsd: subCost,
    numTurns: 0,
  };

  return { main, subagent, mainModel };
}

export function diagnoseQueryUsage(
  result: Pick<QueryResult, 'usage' | 'totalCostUsd' | 'numTurns' | 'sdkSessionId' | 'modelUsage' | 'mainModel'>,
  context: UsageAnomalyContext = {},
): UsageAnomalyReport | null {
  if (result.usage === undefined) return null;

  const aggregateMetrics = getUsageAnomalyMetrics(result.usage, result.totalCostUsd, result.numTurns);
  const split = splitMainSubagentUsage(result.modelUsage, result.mainModel);
  // Use main-session metrics for threshold checks when subagents are present;
  // fall back to aggregate when there's only one model (no subagent split).
  const metrics = split !== null ? { ...split.main, costUsd: aggregateMetrics.costUsd, numTurns: aggregateMetrics.numTurns } : aggregateMetrics;
  const modelBreakdown = getModelBreakdown(result);
  const topCacheCreationModel = modelBreakdown[0];
  const isKnownFirstSessionTurn =
    context.hasResume !== true &&
    context.sessionMessageCount !== undefined &&
    context.sessionMessageCount <= 1;
  const findings: UsageAnomalyFinding[] = [];

  if (
    context.hasResume === true &&
    metrics.cacheReadTokens === 0 &&
    metrics.cacheCreationTokens >= RESUMED_CACHE_COLD_START_TOKENS
  ) {
    findings.push({
      code: 'resumed_cache_cold_start',
      severity: 'warn',
      title: 'resumed cache cold start',
      detail: `Resumed SDK session read 0 cache tokens and wrote ${formatTokenShort(metrics.cacheCreationTokens)} cache tokens; cached prefix was not reusable.`,
      alert: true,
    });
  } else if (
    context.hasResume === true &&
    metrics.cacheHitPct < LOW_CACHE_HIT_PCT &&
    metrics.cacheCreationTokens >= RESUMED_CACHE_COLD_START_TOKENS
  ) {
    findings.push({
      code: 'resumed_cache_partial_rewrite',
      severity: 'warn',
      title: 'resumed cache partial rewrite',
      detail: `Resumed SDK session hit only ${metrics.cacheHitPct}% and wrote ${formatTokenShort(metrics.cacheCreationTokens)} cache tokens; most of the cached prefix was not reusable.`,
      alert: true,
    });
  } else if (metrics.cacheCreationTokens >= LARGE_CACHE_CREATION_TOKENS) {
    if (isKnownFirstSessionTurn) {
      findings.push({
        code: 'large_initial_cache_write',
        severity: 'info',
        title: 'large initial cache write',
        detail: `First SDK session turn wrote ${formatTokenShort(metrics.cacheCreationTokens)} cache tokens; this can be normal warm-up.`,
        alert: false,
      });
    } else {
      const isHuge = metrics.cacheCreationTokens >= HUGE_CACHE_CREATION_TOKENS;
      const isHealthyHitRate = metrics.cacheHitPct >= 90;
      findings.push({
        code: isHuge ? 'huge_cache_creation' : 'large_cache_creation',
        severity: isHealthyHitRate ? 'info' : 'warn',
        title: isHuge ? 'huge cache creation' : 'large cache creation',
        detail: [
          `${formatTokenShort(metrics.cacheCreationTokens)} cache creation tokens after the session was already active; hit ${metrics.cacheHitPct}%.`,
          topCacheCreationModel !== undefined && topCacheCreationModel.cacheCreationTokens > 0
            ? `Top writer: ${topCacheCreationModel.model} wrote ${formatTokenShort(topCacheCreationModel.cacheCreationTokens)} cache tokens.`
            : undefined,
        ].filter((part): part is string => part !== undefined).join(' '),
        alert: !isHealthyHitRate,
      });
    }
  }

  if (findings.length === 0) return null;

  const severity = findings.some((finding) => finding.severity === 'warn') ? 'warn' : 'info';
  const shouldAlert = findings.some((finding) => finding.alert);
  const likelyCause = inferLikelyCause(metrics, context, isKnownFirstSessionTurn, modelBreakdown);
  const links = buildLinks(context);
  const title = findings[0]?.title ?? 'usage anomaly';
  const mainLabel = split !== null ? ' (main)' : '';
  const subagentSuffix = split !== null && split.subagent.cacheCreationTokens > 0
    ? ` Subagent: write ${formatTokenShort(split.subagent.cacheCreationTokens)}.`
    : '';
  const message = [
    `Usage anomaly: ${title}.`,
    `hit${mainLabel} ${metrics.cacheHitPct}%, write ${formatTokenShort(metrics.cacheCreationTokens)}, read ${formatTokenShort(metrics.cacheReadTokens)}.`,
    `Likely cause: ${likelyCause}.`,
    subagentSuffix,
  ].filter(Boolean).join(' ');

  const report: UsageAnomalyReport = {
    severity,
    shouldAlert,
    activityType: 'session.cache_bust',
    title,
    message,
    details: buildDetails(result, context, metrics, findings, likelyCause),
    likelyCause,
    findings,
    metrics,
  };
  if (modelBreakdown.length > 0) report.modelBreakdown = modelBreakdown;
  if (links.length > 0) report.links = links;
  return report;
}

export function formatUsageAnomalySummary(report: UsageAnomalyReport): string {
  return `${report.likelyCause} (write ${formatTokenShort(report.metrics.cacheCreationTokens)}, hit ${report.metrics.cacheHitPct}%)`;
}

function getUsageAnomalyMetrics(
  usage: QueryUsage,
  totalCostUsd: number | undefined,
  numTurns: number | undefined,
): UsageAnomalyMetrics {
  const freshInputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const cacheReadTokens = usage.cacheReadInputTokens ?? 0;
  const cacheCreationTokens = usage.cacheCreationInputTokens ?? 0;
  const totalInputTokens = freshInputTokens + cacheReadTokens + cacheCreationTokens;
  const cacheHitPct = totalInputTokens > 0 ? Math.round((cacheReadTokens / totalInputTokens) * 100) : 0;
  const cacheWritePct = totalInputTokens > 0 ? Math.round((cacheCreationTokens / totalInputTokens) * 100) : 0;
  return {
    freshInputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalInputTokens,
    cacheHitPct,
    cacheWritePct,
    costUsd: totalCostUsd ?? usage.costUsd ?? 0,
    numTurns: numTurns ?? 0,
  };
}

function getModelBreakdown(
  result: Pick<QueryResult, 'modelUsage'>,
): UsageAnomalyModelMetrics[] {
  return Object.entries(result.modelUsage ?? {})
    .map(([model, usage]) => ({
      model,
      ...getUsageAnomalyMetrics(usage, usage.costUsd, undefined),
      webSearchRequests: usage.webSearchRequests ?? 0,
    }))
    .filter((entry) => entry.totalInputTokens > 0 || entry.outputTokens > 0 || entry.costUsd > 0)
    .sort((left, right) => right.cacheCreationTokens - left.cacheCreationTokens);
}

function inferLikelyCause(
  metrics: UsageAnomalyMetrics,
  context: UsageAnomalyContext,
  isKnownFirstSessionTurn: boolean,
  modelBreakdown: UsageAnomalyModelMetrics[],
): string {
  if (context.promptCacheMutation?.reason !== undefined) {
    return `transcript tail mutation (${context.promptCacheMutation.reason})`;
  }
  if (
    context.hasResume === true &&
    metrics.cacheReadTokens === 0 &&
    metrics.cacheCreationTokens >= RESUMED_CACHE_COLD_START_TOKENS
  ) {
    return 'resumed session cache prefix was not reusable, likely prompt/session options changed or cache lineage reset';
  }
  if (
    context.hasResume === true &&
    metrics.cacheHitPct < LOW_CACHE_HIT_PCT &&
    metrics.cacheCreationTokens >= RESUMED_CACHE_COLD_START_TOKENS
  ) {
    return 'resumed session reused only part of the cache, likely prompt/session options changed before the previous stable prefix';
  }
  if (isKnownFirstSessionTurn && metrics.cacheCreationTokens >= LARGE_CACHE_CREATION_TOKENS) {
    return 'first SDK session cache warm-up';
  }
  const topModel = modelBreakdown[0];
  if (topModel !== undefined && metrics.cacheCreationTokens > 0) {
    const topShare = topModel.cacheCreationTokens / metrics.cacheCreationTokens;
    if (topShare >= 0.5 && topModel.webSearchRequests > 0) {
      const searchText = topModel.webSearchRequests > 0
        ? ` with ${topModel.webSearchRequests} web searches`
        : '';
      return `subagent cache creation dominated by ${topModel.model} (${formatTokenShort(topModel.cacheCreationTokens)} write${searchText})`;
    }
    if (topShare >= 0.75) {
      return `model-specific cache creation dominated by ${topModel.model} (${formatTokenShort(topModel.cacheCreationTokens)} write)`;
    }
  }
  if (metrics.cacheCreationTokens >= LARGE_CACHE_CREATION_TOKENS && metrics.cacheHitPct < LOW_CACHE_HIT_PCT) {
    return metrics.cacheReadTokens > 0
      ? 'prefix drift or cache TTL miss caused a partial rewrite'
      : 'cache prefix was not reusable, likely TTL miss or fresh transcript root';
  }
  return 'cache usage crossed an observability threshold';
}

function buildDetails(
  result: Pick<QueryResult, 'sdkSessionId' | 'modelUsage'>,
  context: UsageAnomalyContext,
  metrics: UsageAnomalyMetrics,
  findings: UsageAnomalyFinding[],
  likelyCause: string,
): string {
  const lines = [
    context.sessionId !== undefined ? `session=${context.sessionId}` : undefined,
    context.sdkSessionId !== undefined ? `sdkSession=${context.sdkSessionId}` : result.sdkSessionId !== undefined ? `sdkSession=${result.sdkSessionId}` : undefined,
    context.queryMetricId !== undefined ? `queryMetric=#${context.queryMetricId}` : undefined,
    context.agentId !== undefined ? `agent=${context.agentId}` : undefined,
    context.chatId !== undefined ? `chatId=${context.chatId}` : undefined,
    context.userId !== undefined ? `userId=${context.userId}` : undefined,
    context.discordUrl !== undefined ? `discordThread=${context.discordUrl}` : undefined,
    context.sourceMessageUrl !== undefined ? `discordMessage=${context.sourceMessageUrl}` : undefined,
    context.jsonlPath !== undefined ? `jsonl=${context.jsonlPath}` : undefined,
    context.cwd !== undefined ? `cwd=${context.cwd}` : undefined,
    context.sessionMessageCount !== undefined ? `sessionMessages=${context.sessionMessageCount}` : undefined,
    context.hasResume !== undefined ? `hasResume=${context.hasResume}` : undefined,
    `usage fresh=${metrics.freshInputTokens} output=${metrics.outputTokens} cacheRead=${metrics.cacheReadTokens} cacheCreation=${metrics.cacheCreationTokens} hitPct=${metrics.cacheHitPct} writePct=${metrics.cacheWritePct} costUsd=${metrics.costUsd.toFixed(6)} turns=${metrics.numTurns}`,
    ...getModelBreakdown(result).map(formatModelBreakdownLine),
    context.promptCacheMutation !== undefined
      ? `lastPromptCacheMutation=${context.promptCacheMutation.reason} at=${new Date(context.promptCacheMutation.at).toISOString()} detail=${context.promptCacheMutation.detail ?? ''}`
      : undefined,
    `likelyCause=${likelyCause}`,
    `findings=${findings.map((finding) => finding.code).join(',')}`,
    'next=Open Discord thread/source message, inspect jsonl path and query_metrics row, then compare cacheRead/cacheCreation with the previous turn.',
  ].filter((line): line is string => line !== undefined && line.length > 0);
  return lines.join('\n');
}

function buildLinks(context: UsageAnomalyContext): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];
  if (context.discordUrl !== undefined) {
    links.push({ label: 'Discord thread', url: context.discordUrl });
  }
  if (context.sourceMessageUrl !== undefined && context.sourceMessageUrl !== context.discordUrl) {
    links.push({ label: 'Source message', url: context.sourceMessageUrl });
  }
  return links;
}

function formatModelBreakdownLine(entry: UsageAnomalyModelMetrics): string {
  const web = entry.webSearchRequests > 0 ? ` webSearch=${entry.webSearchRequests}` : '';
  return `model[${entry.model}] fresh=${entry.freshInputTokens} output=${entry.outputTokens} cacheRead=${entry.cacheReadTokens} cacheCreation=${entry.cacheCreationTokens} hitPct=${entry.cacheHitPct} writePct=${entry.cacheWritePct} costUsd=${entry.costUsd.toFixed(6)}${web}`;
}

export function formatTokenShort(value: number): string {
  const safeValue = Math.max(0, Math.round(value));
  if (safeValue >= 1_000_000) return `${(safeValue / 1_000_000).toFixed(1)}M`;
  if (safeValue >= 10_000) return `${Math.round(safeValue / 1000)}K`;
  if (safeValue >= 1000) return `${(safeValue / 1000).toFixed(1)}K`;
  return safeValue.toLocaleString();
}
