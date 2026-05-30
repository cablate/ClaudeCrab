/**
 * DiscordInteractionUI — Discord Embed rendering for interactive prompts.
 *
 * Extracted from DiscordAdapter.ts to reduce file size.
 * Handles permission, question, and plan-review prompt Embeds + buttons.
 * Does NOT own any state; all dependencies are passed in.
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';
import type {
  PermissionPromptOptions,
  PermissionPromptResult,
  PermissionResolver,
  QuestionPromptOptions,
  QuestionPromptResult,
  QuestionResolver,
  ExitPlanModePromptOptions,
  ExitPlanModePromptResult,
  ExitPlanModeResolver,
} from '../types.js';

// ============================================================
// Permission Prompts
// ============================================================

export interface PermissionRenderDeps {
  resolveChannel(chatId: string): Promise<TextChannel | ThreadChannel | null>;
  rateLimitedSend<T>(fn: () => Promise<T>): Promise<T>;
  log: { error: (obj: Record<string, unknown>, msg: string) => void; warn: (obj: Record<string, unknown>, msg: string) => void };
}

export async function sendPermissionPrompt(
  deps: PermissionRenderDeps,
  chatId: string,
  options: PermissionPromptOptions,
): Promise<PermissionPromptResult> {
  try {
    const channel = await deps.resolveChannel(chatId);
    if (channel === null) {
      return { success: false, error: 'No channel available' };
    }

    const embed = new EmbedBuilder()
      .setTitle('🔐 Permission Request')
      .setColor(0xFFA500)
      .addFields(
        { name: 'Tool', value: options.toolName, inline: true },
        { name: 'Reason', value: options.decisionReason ?? 'N/A', inline: true },
      )
      .setTimestamp();

    if (options.blockedPath !== undefined) {
      embed.addFields({ name: 'Path', value: `\`${options.blockedPath}\`` });
    }

    const inputSummary = JSON.stringify(options.toolInput, null, 2);
    if (inputSummary.length > 0 && inputSummary !== '{}') {
      embed.addFields({
        name: 'Input',
        value: `\`\`\`json\n${inputSummary.slice(0, 1000)}\n\`\`\``,
      });
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`perm:allow:${options.requestId}`)
        .setLabel('Allow')
        .setStyle(3),
      new ButtonBuilder()
        .setCustomId(`perm:always:${options.requestId}`)
        .setLabel('Always Allow')
        .setStyle(1),
      new ButtonBuilder()
        .setCustomId(`perm:deny:${options.requestId}`)
        .setLabel('Deny')
        .setStyle(4),
    );

    const msg = await deps.rateLimitedSend(() => channel.send({ embeds: [embed], components: [row] }));
    return { success: true, messageId: msg.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    deps.log.error({ event_type: 'adapter.send_error', err: error }, 'Failed to send permission prompt');
    return { success: false, error: errorMessage };
  }
}

export async function updatePermissionPrompt(
  deps: PermissionRenderDeps,
  chatId: string,
  messageId: string,
  text: string,
): Promise<void> {
  try {
    const channel = await deps.resolveChannel(chatId);
    if (channel === null) return;

    const message = await channel.messages.fetch(messageId);
    await deps.rateLimitedSend(() => message.edit({ content: text, components: [] }));
  } catch (error) {
    deps.log.warn({ event_type: 'adapter.send_error', err: error, messageId }, 'Failed to update permission prompt');
  }
}

// ============================================================
// Question Prompts
// ============================================================

export async function sendQuestionPrompt(
  deps: PermissionRenderDeps,
  chatId: string,
  options: QuestionPromptOptions,
): Promise<QuestionPromptResult> {
  try {
    const channel = await deps.resolveChannel(chatId);
    if (channel === null) {
      return { success: false, error: 'No channel available' };
    }

    const embed = new EmbedBuilder()
      .setTitle(`❓ ${options.header}`)
      .setDescription(options.question)
      .setColor(0x5865F2);

    // Build option buttons (max 5 per row, max 5 rows)
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();
    let btnCount = 0;

    for (let i = 0; i < options.options.length; i++) {
      const opt = options.options[i]!;
      if (btnCount >= 5) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder<ButtonBuilder>();
        btnCount = 0;
        if (rows.length >= 5) break;
      }
      currentRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`question:${options.requestId}:${i}`)
          .setLabel(opt.label.slice(0, 80))
          .setStyle(2),
      );
      btnCount++;
    }
    if (btnCount > 0) rows.push(currentRow);

    const msg = await deps.rateLimitedSend(() => channel.send({ embeds: [embed], components: rows }));
    return { success: true, messageId: msg.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    deps.log.error({ event_type: 'adapter.send_error', err: error }, 'Failed to send question prompt');
    return { success: false, error: errorMessage };
  }
}

export async function updateQuestionPrompt(
  deps: PermissionRenderDeps,
  chatId: string,
  messageId: string,
  text: string,
): Promise<void> {
  try {
    const channel = await deps.resolveChannel(chatId);
    if (channel === null) return;

    const message = await channel.messages.fetch(messageId);
    await deps.rateLimitedSend(() => message.edit({ content: text, components: [] }));
  } catch (error) {
    deps.log.warn({ event_type: 'adapter.send_error', err: error, messageId }, 'Failed to update question prompt');
  }
}

// ============================================================
// Exit Plan Mode Prompts
// ============================================================

export async function sendExitPlanModePrompt(
  deps: PermissionRenderDeps,
  chatId: string,
  options: ExitPlanModePromptOptions,
): Promise<ExitPlanModePromptResult> {
  try {
    const channel = await deps.resolveChannel(chatId);
    if (channel === null) {
      return { success: false, error: 'No channel available' };
    }

    const allowedList = options.allowedPrompts?.length
      ? options.allowedPrompts.map((p) => `• **${p.tool}**: ${p.prompt}`).join('\n')
      : '（無特殊權限）';

    const embed = new EmbedBuilder()
      .setTitle('📋 Plan Review')
      .setDescription('Claude 已完成計畫，請審核：')
      .addFields({ name: '需要的權限', value: allowedList.slice(0, 1024) })
      .setColor(0x2B2D31)
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`plan:approve:${options.requestId}`)
        .setLabel('Approve Plan')
        .setStyle(3),
      new ButtonBuilder()
        .setCustomId(`plan:reject:${options.requestId}`)
        .setLabel('Reject Plan')
        .setStyle(4),
    );

    const msg = await deps.rateLimitedSend(() => channel.send({ embeds: [embed], components: [row] }));
    return { success: true, messageId: msg.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    deps.log.error({ event_type: 'adapter.send_error', err: error }, 'Failed to send plan review prompt');
    return { success: false, error: errorMessage };
  }
}

export async function updateExitPlanModePrompt(
  deps: PermissionRenderDeps,
  chatId: string,
  messageId: string,
  text: string,
): Promise<void> {
  try {
    const channel = await deps.resolveChannel(chatId);
    if (channel === null) return;

    const message = await channel.messages.fetch(messageId);
    await deps.rateLimitedSend(() => message.edit({ content: text, components: [] }));
  } catch (error) {
    deps.log.warn({ event_type: 'adapter.send_error', err: error, messageId }, 'Failed to update plan review prompt');
  }
}

// ============================================================
// Button Interaction Routing
// ============================================================

export interface ButtonHandlerDeps {
  permissionResolver: PermissionResolver | null;
  questionResolver: QuestionResolver | null;
  exitPlanModeResolver: ExitPlanModeResolver | null;
  log: { debug: (obj: Record<string, unknown>, msg: string) => void; warn: (obj: Record<string, unknown>, msg: string) => void };
}

export function handleButtonInteraction(deps: ButtonHandlerDeps, customId: string): boolean {
  const parts = customId.split(':');
  if (parts.length < 3) return false;

  const type = parts[0];
  const action = parts[1];
  const requestId = parts[2];

  if (type === undefined || action === undefined || requestId === undefined) {
    return false;
  }

  deps.log.debug({ customId, type, action, requestId }, 'Button interaction received');

  if (type === 'perm' && deps.permissionResolver !== null) {
    const decision = action as 'allow' | 'always' | 'deny';
    deps.permissionResolver(requestId, decision);
    return true;
  }

  if (type === 'question' && deps.questionResolver !== null) {
    const questionRequestId = parts[1];
    const optionIndex = parts[2];
    if (questionRequestId !== undefined && optionIndex !== undefined) {
      deps.questionResolver(questionRequestId, optionIndex);
    }
    return true;
  }

  if (type === 'plan' && deps.exitPlanModeResolver !== null) {
    const decision: 'approve' | 'reject' = action === 'approve' ? 'approve' : 'reject';
    deps.exitPlanModeResolver(requestId, decision);
    return true;
  }

  deps.log.warn({ customId }, 'Unhandled button interaction — no resolver found');
  return false;
}
