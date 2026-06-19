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
} from 'discord.js';
import type { DiscordAdapter } from '../DiscordAdapter.js';
import { handleSlashCommand, type SlashCommandDependencies } from './DiscordSlashCommands.js';
import { logger } from '../../utils/logger.js';
import { EventType } from '../../utils/events.js';

const log = logger.child({ module: 'DiscordInteractionHandler' });

interface DiscordInteractionHandlerOptions {
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
   * Register an adapter for button routing
   */
  registerAdapter(agentId: string, adapter: DiscordAdapter): void {
    this.adapters.set(agentId, adapter);
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
   */
  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;
    log.debug({ customId, userId: interaction.user.id }, 'Button interaction received');

    // --- sess: buttons for /sessions command ---
    // Admin gate check before deferUpdate — needs ephemeral reply on rejection
    if (customId.startsWith('sess:')) {
      await this.handleSessionButton(interaction);
      return;
    }

    // MUST acknowledge within 3 seconds — deferUpdate FIRST, then process
    try {
      await interaction.deferUpdate();
    } catch (e) {
      log.debug({ err: e, customId }, 'deferUpdate failed (likely already acknowledged by per-agent handler)');
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
        await interaction.message.edit({ components: [] });
      } catch {
        try {
          await interaction.editReply({ components: [] });
        } catch (e) {
          log.debug({ err: e, customId }, 'Failed to remove buttons after handling');
        }
      }
    } else {
      log.warn({ customId }, 'No handler found for button interaction');
    }
  }

  /**
   * Handle sess: button interactions from /sessions command.
   * Flow: admin gate (reply ephemeral if rejected) → deferUpdate → process → editReply/followUp.
   */
  private async handleSessionButton(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;

    // Admin gate — BEFORE deferUpdate so we can send ephemeral reply
    const ownerId = process.env['DISCORD_OWNER_USER_ID'];
    if (!ownerId || interaction.user.id !== ownerId) {
      try {
        await interaction.reply({ content: '❌ 僅 admin 可用', ephemeral: true });
      } catch (e) {
        log.debug({ err: e, customId }, 'sess: admin gate reply failed');
      }
      return;
    }

    const sdkSessionManager = this.slashCommandDeps?.sdkSessionManager;
    if (!sdkSessionManager) {
      try {
        await interaction.reply({ content: '❌ SDKSessionManager 不可用', ephemeral: true });
      } catch (e) {
        log.debug({ err: e, customId }, 'sess: no sdkSessionManager reply failed');
      }
      return;
    }

    // Acknowledge — we will update the original message on success
    try {
      await interaction.deferUpdate();
    } catch (e) {
      log.warn({ err: e, customId }, 'sess: deferUpdate failed — interaction may have expired');
      return;
    }

    try {
      if (customId === 'sess:closeall') {
        const summaries = sdkSessionManager.getSessionSummaries();
        let closed = 0;
        let skipped = 0;
        for (const s of summaries) {
          if (s.isQuerying) { skipped++; continue; }
          sdkSessionManager.destroySession(s.sessionId);
          closed++;
        }
        log.info({ event_type: EventType.SESSION_ADMIN_CLOSE, action: 'closeall', closed, skipped, by: interaction.user.id }, '/sessions closeall');
        await interaction.editReply({
          content: `✅ 已關閉 ${closed} 個 session${skipped > 0 ? `，跳過 ${skipped} 個正在查詢` : ''}`,
          embeds: [],
          components: [],
        });

      } else if (customId === 'sess:closeidle') {
        const summaries = sdkSessionManager.getSessionSummaries();
        const oneHourAgo = Date.now() - 3_600_000;
        let closed = 0;
        for (const s of summaries) {
          if (s.isQuerying || s.lastQueryAt >= oneHourAgo) continue;
          sdkSessionManager.destroySession(s.sessionId);
          closed++;
        }
        log.info({ event_type: EventType.SESSION_ADMIN_CLOSE, action: 'closeidle', closed, by: interaction.user.id }, '/sessions closeidle');
        await interaction.editReply({
          content: `🧹 已關閉 ${closed} 個閒置 >1h 的 session`,
          embeds: [],
          components: [],
        });

      } else if (customId.startsWith('sess:close:')) {
        const sessionId = customId.slice('sess:close:'.length);
        const summaries = sdkSessionManager.getSessionSummaries();
        const target = summaries.find(s => s.sessionId === sessionId);

        if (!target) {
          // Session already gone — followUp ephemeral, keep original message intact
          await interaction.followUp({ content: '❌ Session 不存在或已關閉', ephemeral: true });
          return;
        }
        if (target.isQuerying) {
          await interaction.followUp({ content: '⚠️ 此 session 正在查詢中，請稍後再試', ephemeral: true });
          return;
        }

        sdkSessionManager.destroySession(sessionId);
        log.info({ event_type: EventType.SESSION_ADMIN_CLOSE, action: 'close', sessionId, by: interaction.user.id }, '/sessions close');
        await interaction.editReply({
          content: `✅ Session 已關閉：\`${sessionId}\``,
          embeds: [],
          components: [],
        });

      } else {
        log.warn({ customId }, 'Unknown sess: action');
      }
    } catch (e) {
      log.error({ err: e, customId }, 'sess: button handler error');
      try {
        await interaction.followUp({ content: '❌ 操作失敗，請重試', ephemeral: true });
      } catch { /* interaction expired */ }
    }
  }

  /**
   * Handle modal submit interactions.
   */
  private handleModalSubmit(interaction: ModalSubmitInteraction): void {
    log.warn({ customId: interaction.customId }, 'Unhandled modal submit');
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
