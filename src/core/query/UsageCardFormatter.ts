/**
 * UsageCardFormatter — Per-turn usage summary card formatting.
 *
 * Extracted from QueryExecutor.ts to separate usage card concern
 * from query execution logic.
 */

import { EmbedBuilder } from 'discord.js';
import type { BaseAdapter } from '../../adapters/BaseAdapter.js';
import type { QueryResult } from './SDKQueryManager.js';
import { diagnoseQueryUsage, formatUsageAnomalySummary, splitMainSubagentUsage, type UsageAnomalyReport } from '../keepalive/UsageAnomalyDiagnostics.js';

function formatTokenShort(value: number): string {
  const safeValue = Math.max(0, Math.round(value));
  if (safeValue >= 1_000_000) return `${(safeValue / 1_000_000).toFixed(1)}M`;
  if (safeValue >= 10_000) return `${Math.round(safeValue / 1000)}K`;
  if (safeValue >= 1000) return `${(safeValue / 1000).toFixed(1)}K`;
  return safeValue.toLocaleString();
}

function formatProgressBar(pct: number | undefined, width = 10): string {
  const safePct = Math.max(0, Math.min(100, Math.round(pct ?? 0)));
  const filled = Math.round((safePct / 100) * width);
  return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)}`;
}

function formatTurnLabel(turns: number): string {
  return `${turns} ${turns === 1 ? 'turn' : 'turns'}`;
}

function uniqueActualModels(result: QueryResult): string[] {
  if (result.modelUsage !== undefined) return Object.keys(result.modelUsage);
  return [...new Set(result.actualModels ?? [])];
}

function formatModelUsageLines(result: QueryResult, totalCost: number): string[] {
  const modelUsage = result.modelUsage;
  if (modelUsage !== undefined) {
    const entries = Object.entries(modelUsage)
      .filter(([, usage]) => usage.costUsd > 0 || usage.inputTokens > 0 || usage.outputTokens > 0 || usage.cacheCreationInputTokens > 0 || usage.cacheReadInputTokens > 0)
      .sort(([, left], [, right]) => right.costUsd - left.costUsd);
    if (entries.length > 0) {
      return entries.map(([model, usage]) => `• ${model} · $${usage.costUsd.toFixed(3)}`);
    }
  }

  const actualModels = uniqueActualModels(result);
  if (actualModels.length === 1 && actualModels[0] !== undefined) {
    return [`• ${actualModels[0]} · $${totalCost.toFixed(4)}`];
  }
  return actualModels.map((model) => `• ${model}`);
}

function formatCacheModelBreakdown(result: QueryResult): string[] {
  const modelUsage = result.modelUsage;
  if (modelUsage === undefined) return [];
  const entries = Object.entries(modelUsage)
    .filter(([, usage]) => (usage.cacheCreationInputTokens ?? 0) > 0 || (usage.cacheReadInputTokens ?? 0) > 0)
    .sort(([, left], [, right]) => (right.cacheCreationInputTokens ?? 0) - (left.cacheCreationInputTokens ?? 0));
  if (entries.length <= 1) return [];
  return entries.map(([model, usage]) => {
    const shortModel = model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
    return `  ${shortModel}: w ${formatTokenShort(usage.cacheCreationInputTokens ?? 0)} · r ${formatTokenShort(usage.cacheReadInputTokens ?? 0)}`;
  });
}

export interface UsageQuotaSummary {
  fiveHourPct?: number;
  sevenDayPct?: number;
}

type UsageContext = NonNullable<QueryResult['contextUsage']>;

function buildContextBreakdownLines(ctx: UsageContext): string[] {
  if (ctx.categories.length === 0) return [];
  return [ctx.categories
    .filter((c) => c.tokens > 0)
    .map((c) => `${c.name.toLowerCase()} ${formatTokenShort(c.tokens)}`)
    .join(' · ')];
}

function getUsageSummaryColor(hitPct: number, _quota: UsageQuotaSummary): number {
  if (hitPct < 50) return 0xD83A34;
  if (hitPct < 85) return 0xF0B429;
  return 0x2E7D32;
}

function getUsageSummaryParts(
  result: QueryResult,
  quota: UsageQuotaSummary,
  providedAnomaly?: UsageAnomalyReport | null,
): {
  title: string;
  description: string;
  cache: string;
  anomaly?: string;
  context?: string;
  quota?: string;
  color: number;
} | null {
  if (!result.usage) return null;

  const u = result.usage;
  const turns = result.numTurns ?? 1;
  const cost = result.totalCostUsd ?? u.costUsd ?? 0;

  const split = splitMainSubagentUsage(result.modelUsage, result.mainModel);
  const mainRead = split !== null ? split.main.cacheReadTokens : (u.cacheReadInputTokens ?? 0);
  const mainCreate = split !== null ? split.main.cacheCreationTokens : (u.cacheCreationInputTokens ?? 0);
  const mainFresh = split !== null ? split.main.freshInputTokens : u.inputTokens;
  const mainThroughput = mainFresh + mainRead + mainCreate;
  const hitPct = mainThroughput > 0 ? Math.round((mainRead / mainThroughput) * 100) : 0;

  const description = [
    `${formatTurnLabel(turns)} · fresh ${formatTokenShort(u.inputTokens)} · output ${formatTokenShort(u.outputTokens)}`,
    ...formatModelUsageLines(result, cost),
  ].join('\n');

  const cacheLines = [
    `${hitPct}% hit${split !== null ? ' (main)' : ''}`,
    formatProgressBar(hitPct),
    `fresh ${formatTokenShort(mainFresh)} · write ${formatTokenShort(mainCreate)} · read ${formatTokenShort(mainRead)}`,
    ...formatCacheModelBreakdown(result),
  ];
  if (split !== null && split.subagent.cacheCreationTokens > 0) {
    cacheLines.push(`subagent: write ${formatTokenShort(split.subagent.cacheCreationTokens)} · read ${formatTokenShort(split.subagent.cacheReadTokens)}`);
  }
  const cache = cacheLines.join('\n');

  let context: string | undefined;
  if (result.contextUsage !== undefined) {
    const ctx = result.contextUsage;
    context = [
      `${formatTokenShort(ctx.totalTokens)} / ${formatTokenShort(ctx.maxTokens)} · ${Math.round(ctx.percentage)}%`,
      formatProgressBar(ctx.percentage),
      ...buildContextBreakdownLines(ctx),
    ].join('\n');
  } else if (result.contextTokens !== undefined) {
    context = formatTokenShort(result.contextTokens);
  }

  const quotaParts: string[] = [];
  if (quota.fiveHourPct !== undefined) quotaParts.push(`5h ${quota.fiveHourPct.toFixed(0)}% ${formatProgressBar(quota.fiveHourPct, 6)}`);
  if (quota.sevenDayPct !== undefined) quotaParts.push(`7d ${quota.sevenDayPct.toFixed(0)}% ${formatProgressBar(quota.sevenDayPct, 6)}`);
  const anomalyReport = providedAnomaly ?? diagnoseQueryUsage(result);
  const anomaly = anomalyReport !== null ? formatUsageAnomalySummary(anomalyReport).slice(0, 1000) : undefined;

  return {
    title: `📊 Usage · $${cost.toFixed(4)}`,
    description,
    cache,
    ...(anomaly !== undefined ? { anomaly } : {}),
    ...(context !== undefined ? { context } : {}),
    ...(quotaParts.length > 0 ? { quota: quotaParts.join('\n') } : {}),
    color: anomalyReport?.shouldAlert === true
      ? 0xD83A34
      : getUsageSummaryColor(hitPct, quota),
  };
}

function buildUsageSummaryCardText(
  result: QueryResult,
  quota: UsageQuotaSummary,
  anomaly?: UsageAnomalyReport | null,
): string | null {
  const parts = getUsageSummaryParts(result, quota, anomaly);
  if (parts === null) return null;

  const lines = [
    parts.title,
    parts.description,
    '',
    '🧊 Cache',
    parts.cache,
  ];

  if (parts.anomaly !== undefined) lines.push('', '⚠ Anomaly', parts.anomaly);
  if (parts.context !== undefined) lines.push('', '🧱 Context', parts.context);
  if (parts.quota !== undefined) lines.push('', '⏳ Quota', parts.quota);

  return lines.join('\n');
}

export function buildUsageSummaryEmbed(
  result: QueryResult,
  quota: UsageQuotaSummary = {},
  anomaly?: UsageAnomalyReport | null,
): EmbedBuilder | null {
  const parts = getUsageSummaryParts(result, quota, anomaly);
  if (parts === null) return null;

  const embed = new EmbedBuilder()
    .setTitle(parts.title)
    .setDescription(parts.description)
    .setColor(parts.color);

  embed.addFields({ name: '🧊 Cache', value: parts.cache, inline: true });
  if (parts.context !== undefined) embed.addFields({ name: '🧱 Context', value: parts.context, inline: true });
  if (parts.quota !== undefined) embed.addFields({ name: '⏳ Quota', value: parts.quota, inline: true });
  if (parts.anomaly !== undefined) embed.addFields({ name: '⚠ Anomaly', value: parts.anomaly, inline: false });

  return embed;
}

export function buildUsageSummaryText(
  result: QueryResult,
  quota: UsageQuotaSummary = {},
  anomaly?: UsageAnomalyReport | null,
): string | null {
  return buildUsageSummaryCardText(result, quota, anomaly);
}

export async function deliverUsageSummary(
  result: QueryResult,
  adapter: BaseAdapter,
  chatId: string,
  anomaly?: UsageAnomalyReport | null,
): Promise<void> {
  let quota: UsageQuotaSummary = {};

  try {
    const { getOAuthUsage } = await import('../../services/OAuthUsageService.js');
    const oauthUsage = await getOAuthUsage();
    if (oauthUsage) {
      quota = {
        ...(oauthUsage.five_hour ? { fiveHourPct: oauthUsage.five_hour.utilization } : {}),
        ...(oauthUsage.seven_day ? { sevenDayPct: oauthUsage.seven_day.utilization } : {}),
      };
    }
  } catch { /* ignore — OAuth usage is optional */ }

  const embed = buildUsageSummaryEmbed(result, quota, anomaly);
  const embedSender = getUsageEmbedSender(adapter);
  if (embed !== null && embedSender !== null) {
    const sendResult = await embedSender.sendEmbed(chatId, [embed]);
    if (sendResult.success) return;
  }

  const text = buildUsageSummaryText(result, quota, anomaly);
  if (text === null) return;
  await adapter.sendFormattedMessage(chatId, text);
}

interface UsageEmbedSender {
  sendEmbed(chatId: string, embeds: EmbedBuilder[]): Promise<{ success: boolean; error?: string }>;
}

function getUsageEmbedSender(adapter: BaseAdapter): UsageEmbedSender | null {
  const candidate = adapter as BaseAdapter & { sendEmbed?: unknown };
  return typeof candidate.sendEmbed === 'function'
    ? { sendEmbed: candidate.sendEmbed.bind(adapter) as UsageEmbedSender['sendEmbed'] }
    : null;
}
