/**
 * DiscordInteractionHandler — routes Discord button clicks and slash commands.
 *
 * Listens on a discord.js Client's 'interactionCreate' event and dispatches:
 * - Button interactions → DiscordAdapter.handleButtonInteraction()
 * - Slash commands → command handlers (Phase 3+)
 *
 * Designed to work with either the Main Bot or individual Agent Bots.
 */

import type {
  Client,
  Interaction,
  ButtonInteraction,
  ChatInputCommandInteraction,
} from 'discord.js';
import type { DiscordAdapter } from '../DiscordAdapter.js';
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
}

export class DiscordInteractionHandler {
  private readonly client: Client;
  private readonly adapters: Map<string, DiscordAdapter>;
  private readonly findAdapterByChannel: ((channelId: string) => DiscordAdapter | undefined) | null;

  constructor(options: DiscordInteractionHandlerOptions) {
    this.client = options.client;
    this.adapters = options.adapters ?? new Map();
    this.findAdapterByChannel = options.findAdapterByChannel ?? null;

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
    }
    // Other interaction types (select menus, modals) can be added later
  }

  /**
   * Handle button click interactions.
   * Routes to the adapter that sent the original message.
   */
  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;
    log.debug({ customId, userId: interaction.user.id }, 'Button interaction received');

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
      // Acknowledge the interaction — update the message to show it was handled
      try {
        await interaction.update({
          components: [], // Remove buttons after click
        });
      } catch {
        // If update fails (e.g., already deferred), try deferUpdate
        try {
          await interaction.deferUpdate();
        } catch {
          // Interaction may have already been acknowledged
        }
      }
    } else {
      // Unknown button — acknowledge silently
      try {
        await interaction.deferUpdate();
      } catch {
        // Already acknowledged
      }
      log.warn({ customId }, 'No handler found for button interaction');
    }
  }

  /**
   * Handle slash command interactions.
   * Phase 3+: /task, /status, /cost, /budget, /schedule, /agent
   */
  private async handleSlashCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const commandName = interaction.commandName;
    log.debug({ commandName, userId: interaction.user.id }, 'Slash command received');

    // Phase 0: acknowledge but don't process (commands registered in Phase 3+)
    try {
      await interaction.reply({
        content: `Command \`/${commandName}\` received. (Coming in Phase 3)`,
        ephemeral: true,
      });
    } catch (error) {
      log.error({ error, commandName }, 'Failed to reply to slash command');
    }
  }
}
