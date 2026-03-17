/**
 * DiscordInteractionHandler — routes Discord button clicks and slash commands.
 *
 * Listens on a discord.js Client's 'interactionCreate' event and dispatches:
 * - Button interactions → DiscordAdapter.handleButtonInteraction()
 * - Slash commands → command handlers (Phase 3+)
 * - Modal submits → handleModalSubmit()
 *
 * Designed to work with either the Main Bot or individual Agent Bots.
 */

import type {
  Client,
  Interaction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  TextInputBuilder,
} from 'discord.js';
import type { DiscordAdapter } from '../DiscordAdapter.js';
import type { TaskService } from '../../services/TaskService.js';
import { handleSlashCommand, type SlashCommandDependencies } from './DiscordSlashCommands.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ module: 'DiscordInteractionHandler' });

/**
 * Registry of adapters by agentId, used to route button clicks
 * to the correct adapter's resolver.
 */
export type AdapterLookup = (agentId: string) => DiscordAdapter | undefined;

export interface DiscordInteractionHandlerOptions {
  /** The discord.js Client to listen on */
  client: Client;

  /**
   * Lookup function to find the adapter that owns a given agentId.
   * Used to route button interactions to the correct resolver.
   */
  findAdapterByChannel?: (channelId: string) => DiscordAdapter | undefined;

  /**
   * All registered Discord adapters (for broadcast-style lookup).
   */
  adapters?: Map<string, DiscordAdapter>;

  /**
   * Dependencies for slash command handling.
   */
  slashCommandDeps?: SlashCommandDependencies;
}

export class DiscordInteractionHandler {
  private readonly client: Client;
  private readonly adapters: Map<string, DiscordAdapter>;
  private readonly findAdapterByChannel: ((channelId: string) => DiscordAdapter | undefined) | null;
  private readonly slashCommandDeps: SlashCommandDependencies | null;

  private taskService?: TaskService;

  /** Tracks pending review timeouts keyed by taskId */
  private reviewTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: DiscordInteractionHandlerOptions) {
    this.client = options.client;
    this.adapters = options.adapters ?? new Map();
    this.findAdapterByChannel = options.findAdapterByChannel ?? null;
    this.slashCommandDeps = options.slashCommandDeps ?? null;

    this.client.on('interactionCreate', (interaction: Interaction) => {
      void this.handle(interaction).catch((error) => {
        log.error({ error }, 'Unhandled error in interaction handler');
      });
    });

    log.info('Discord interaction handler registered');
  }

  /**
   * Wire in a TaskService instance after construction.
   */
  setTaskService(taskService: TaskService): void {
    this.taskService = taskService;
  }

  /**
   * Register an adapter for button routing
   */
  registerAdapter(agentId: string, adapter: DiscordAdapter): void {
    this.adapters.set(agentId, adapter);
  }

  /**
   * Schedule a review timeout. After 24h, disable the buttons.
   */
  scheduleReviewTimeout(taskId: string, channelId: string, messageId: string): void {
    // Clear any existing timeout
    const existing = this.reviewTimeouts.get(taskId);
    if (existing) clearTimeout(existing);

    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    const timer = setTimeout(async () => {
      this.reviewTimeouts.delete(taskId);
      try {
        const channel = await this.client.channels.fetch(channelId);
        if (channel?.isTextBased()) {
          const msg = await (channel as import('discord.js').TextChannel).messages.fetch(messageId);
          await msg.edit({ components: [] }); // Remove buttons
        }
      } catch {
        // Best effort — message may have been deleted
      }
    }, TWENTY_FOUR_HOURS);

    timer.unref(); // Don't prevent process exit
    this.reviewTimeouts.set(taskId, timer);
  }

  /**
   * Clear all review timeouts (for shutdown).
   */
  clearAllTimeouts(): void {
    for (const timer of this.reviewTimeouts.values()) {
      clearTimeout(timer);
    }
    this.reviewTimeouts.clear();
  }

  /**
   * Main interaction dispatcher
   */
  private async handle(interaction: Interaction): Promise<void> {
    if (interaction.isButton()) {
      await this.handleButton(interaction);
    } else if (interaction.isChatInputCommand()) {
      await this.handleSlashCommand(interaction);
    } else if (interaction.isModalSubmit()) {
      await this.handleModalSubmit(interaction);
    }
  }

  /**
   * Handle button click interactions.
   * Routes to the adapter that sent the original message.
   *
   * Special case: review:reject buttons show a modal instead of deferUpdate.
   */
  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;
    log.debug({ customId, userId: interaction.user.id }, 'Button interaction received');

    // --- review: buttons require special handling ---
    // 'approve' path → interaction.update() (replaces message)
    // 'reject' path  → interaction.showModal() (cannot deferUpdate first)
    if (customId.startsWith('review:')) {
      await this.handleReviewButton(interaction);
      return;
    }

    // MUST acknowledge within 3 seconds — deferUpdate FIRST, then process
    try {
      await interaction.deferUpdate();
    } catch {
      // Already acknowledged
    }

    // Try to find the adapter that owns this channel
    let handled = false;

    // First try channel-based lookup
    if (this.findAdapterByChannel !== null) {
      const adapter = this.findAdapterByChannel(interaction.channelId);
      if (adapter !== undefined) {
        handled = adapter.handleButtonInteraction(customId);
      }
    }

    // Fallback: try all adapters
    if (!handled) {
      for (const adapter of this.adapters.values()) {
        handled = adapter.handleButtonInteraction(customId);
        if (handled) break;
      }
    }

    if (handled) {
      // Remove buttons after successful handling
      try {
        await interaction.editReply({ components: [] });
      } catch {
        // Best effort — interaction may have expired
      }
    } else {
      log.warn({ customId }, 'No handler found for button interaction');
    }
  }

  /**
   * Handle review:approve / review:reject button interactions.
   * customId format: review:approve:taskId | review:reject:taskId
   */
  private async handleReviewButton(interaction: ButtonInteraction): Promise<void> {
    const [, decision, taskId] = interaction.customId.split(':');

    if (!taskId || !this.taskService) {
      await interaction.reply({ content: '❌ 無效的審核請求', ephemeral: true });
      return;
    }

    if (decision === 'approve') {
      await this.taskService.updateStatus(taskId, 'done');
      await interaction.update({
        content: `✅ 審核通過 by ${interaction.user.displayName}`,
        components: [], // Remove buttons
      });
    } else if (decision === 'reject') {
      // Show modal for rejection reason — must NOT deferUpdate before showModal
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = await import('discord.js');

      const modal = new ModalBuilder()
        .setCustomId(`review-reject-modal:${taskId}`)
        .setTitle('退回理由');

      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('請說明退回理由')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      const row = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
      modal.addComponents(row);

      await interaction.showModal(modal);
    } else {
      log.warn({ customId: interaction.customId }, 'Unknown review decision');
    }
  }

  /**
   * Handle modal submit interactions.
   */
  private async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    const taskId = interaction.customId.split(':')[1];

    if (interaction.customId.startsWith('review-reject-modal:') && taskId) {
      const reason = interaction.fields.getTextInputValue('reason');

      // Update task status back to in_progress
      await this.taskService?.updateStatus(taskId, 'in_progress');

      // Post rejection reason to main thread
      const task = this.taskService?.getById(taskId);
      if (task?.discord_thread_id) {
        await this.taskService?.postToThread(
          taskId,
          `❌ 退回 by ${interaction.user.displayName}：${reason}`,
          'note'
        );
      }

      await interaction.reply({ content: '✅ 已退回並通知負責人', ephemeral: true });
    } else {
      log.warn({ customId: interaction.customId }, 'Unhandled modal submit');
    }
  }

  /**
   * Handle slash command interactions.
   */
  private async handleSlashCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    log.debug({ commandName: interaction.commandName, userId: interaction.user.id }, 'Slash command received');

    if (this.slashCommandDeps !== null) {
      await handleSlashCommand(interaction, this.slashCommandDeps);
    } else {
      try {
        await interaction.reply({ content: '指令系統尚未初始化', ephemeral: true });
      } catch {
        // Interaction may have expired
      }
    }
  }
}
