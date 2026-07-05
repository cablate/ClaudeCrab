import { SlashCommandBuilder, REST, Routes, PermissionFlagsBits } from 'discord.js';
import type { AgentLoader } from '../../../core/orchestrator/AgentLoader.js';
import type { SessionManager } from '../../../core/session/SessionManager.js';
import type { MessageProcessor } from '../../../core/orchestrator/MessageProcessor.js';
import type { SDKSessionManager } from '../../../core/session/SDKSessionManager.js';
import type { IQueryMetricsRepository, QueryMetricRow } from '../../../persistence/types.js';
export type { QueryMetricRow };
import { diagnoseQueryUsage } from '../../../core/keepalive/UsageAnomalyDiagnostics.js';
import { logger } from '../../../utils/logger.js';

export const log = logger.child({ module: 'DiscordSlashCommands' });

export const CLAUDE_CONTEXT_WINDOW_TOKENS = 200_000;

export interface SlashCommandDependencies {
  agentLoader: AgentLoader;
  sessionManager: SessionManager;
  messageProcessor: MessageProcessor;
  queryMetricsRepository?: IQueryMetricsRepository;
  sdkSessionManager?: SDKSessionManager;
  ownerUserId?: string;
  guildId?: string;
  getBotStatus?: (agentId: string) => 'running' | 'stopped' | 'error' | 'no-token';
}

export function resolveEffectiveUserId(userId: string, channelId: string, isThread: boolean): string {
  if (!isThread) return userId;
  return `${userId}::thread::${channelId}`;
}

export function formatTokenShort(value: number): string {
  const safeValue = Math.max(0, Math.round(value));
  if (safeValue >= 1_000_000) return `${(safeValue / 1_000_000).toFixed(1)}M`;
  if (safeValue >= 10_000) return `${Math.round(safeValue / 1000)}K`;
  if (safeValue >= 1000) return `${(safeValue / 1000).toFixed(1)}K`;
  return safeValue.toLocaleString();
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export function fitSessionDescription(lines: string[], maxDisplay: number, maxChars: number): string {
  const visible: string[] = [];
  for (const line of lines.slice(0, maxDisplay)) {
    const candidate = [...visible, line].join('\n\n');
    const hidden = lines.length - visible.length - 1;
    const suffix = hidden > 0 ? `\n\n... ${hidden} more sessions hidden` : '';
    if ((candidate + suffix).length > maxChars) break;
    visible.push(line);
  }
  if (visible.length === 0) {
    const first = lines[0] ?? '';
    return first.length > maxChars
      ? `${first.slice(0, Math.max(0, maxChars - 16))}\n... truncated`
      : first;
  }
  const hidden = lines.length - visible.length;
  return hidden > 0
    ? `${visible.join('\n\n')}\n\n... ${hidden} more sessions hidden`
    : visible.join('\n\n');
}

export function queryMetricToDiagnosticResult(row: QueryMetricRow) {
  return {
    response: '',
    sdkSessionId: row.sdkSessionId ?? 'unknown',
    numTurns: row.numTurns,
    usage: {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadInputTokens: row.cacheReadTokens,
      cacheCreationInputTokens: row.cacheCreationTokens,
      costUsd: row.totalCostUsd,
    },
    totalCostUsd: row.totalCostUsd,
  };
}

export function formatQueryMetricAnomaly(row: QueryMetricRow, context: {
  sessionId?: string;
  agentId?: string;
  discordUrl?: string;
  sourceMessageUrl?: string;
  jsonlPath?: string;
  sessionMessageCount?: number;
} = {}, alertOnly = false): string | undefined {
  const report = diagnoseQueryUsage(queryMetricToDiagnosticResult(row), {
    ...context,
    chatId: row.chatId,
    userId: row.userId,
    queryMetricId: row.id,
    ...(row.sdkSessionId !== undefined ? { sdkSessionId: row.sdkSessionId } : {}),
  });
  if (report === null || (alertOnly && !report.shouldAlert)) return undefined;
  const codes = report.findings.map((finding) => finding.code).join(',');
  return `${report.severity} ${codes} | hit ${report.metrics.cacheHitPct}% | W ${formatTokenShort(row.cacheCreationTokens)} | R ${formatTokenShort(row.cacheReadTokens)} | $${row.totalCostUsd.toFixed(3)} | ${report.likelyCause}`;
}

export function buildSlashCommands(): SlashCommandBuilder[] {
  return [
    new SlashCommandBuilder()
      .setName('help')
      .setDescription('顯示可用指令'),
    new SlashCommandBuilder()
      .setName('status')
      .setDescription('查看當前頻道的 bot 狀態與用量'),
    new SlashCommandBuilder()
      .setName('reset')
      .setDescription('重置當前頻道的 session（清除對話上下文）')
      .addStringOption(opt =>
        opt.setName('agent').setDescription('Agent ID（留空 = 當前頻道的 Agent）').setRequired(false),
      ) as SlashCommandBuilder,
    new SlashCommandBuilder()
      .setName('model')
      .setDescription('查詢模型設定')
      .addStringOption(opt =>
        opt.setName('agent').setDescription('Agent ID').setRequired(false),
      ) as SlashCommandBuilder,
    new SlashCommandBuilder()
      .setName('cost')
      .setDescription('顯示 token 使用統計與成本'),
    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('停止當前 query（中斷生成）')
      .addStringOption(opt =>
        opt.setName('agent').setDescription('Agent ID').setRequired(false),
      ) as SlashCommandBuilder,
    new SlashCommandBuilder()
      .setName('close')
      .setDescription('關閉 SDK session（需要管理員權限）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,
    new SlashCommandBuilder()
      .setName('sync')
      .setDescription('同步當前 session 的子代理進度（需要管理員權限）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,
    new SlashCommandBuilder()
      .setName('restart')
      .setDescription('重啟 bot（需要管理員權限）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,
    new SlashCommandBuilder()
      .setName('ctx')
      .setDescription('查看當前 context 使用狀況'),
    new SlashCommandBuilder()
      .setName('cache')
      .setDescription('SDK cache 診斷工具')
      .addSubcommand(sub =>
        sub.setName('status').setDescription('全域 cache 健康快照：所有活 session、平均命中率'))
      .addSubcommand(sub =>
        sub.setName('efficiency').setDescription('歷史 cache 命中趨勢（從 DB 算）')
          .addStringOption(opt => opt.setName('agent').setDescription('Agent ID（留空 = 全部）').setRequired(false))
          .addIntegerOption(opt => opt.setName('days').setDescription('回看幾天（預設 7）').setRequired(false).setMinValue(1).setMaxValue(90)))
      .addSubcommand(sub =>
        sub.setName('flush').setDescription('銷毀指定 SDK session（admin）')
          .addStringOption(opt => opt.setName('session').setDescription('SessionId 前 8 碼或完整').setRequired(true))) as SlashCommandBuilder,
    new SlashCommandBuilder()
      .setName('sessions')
      .setDescription('列出 V2 session 摘要'),
  ];
}

export async function registerSlashCommands(
  botToken: string,
  clientId: string,
  guildId: string,
): Promise<void> {
  const commands = buildSlashCommands().map(cmd => cmd.toJSON());
  const rest = new REST({ version: '10' }).setToken(botToken);
  log.info('Registering Discord slash commands...');
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  log.info('Discord slash commands registered');
}
