/**
 * DiscordSlashCommands — router and command registration.
 *
 * Command handlers are extracted to ./commands/ for maintainability.
 * Exports: handleSlashCommand, registerSlashCommands, buildSlashCommands, SlashCommandDependencies
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../../utils/logger.js';
import type { SlashCommandDependencies } from './commands/_shared.js';
import { handleHelp, handleStatus, handleReset, handleModel, handleCost, handleStop } from './commands/user.js';
import { handleClose, handleSync, handleRestart } from './commands/admin.js';
import { handleCtx } from './commands/ctx.js';
import { handleCache } from './commands/cache.js';
import { handleSessions } from './commands/sessions.js';

const log = logger.child({ module: 'DiscordSlashCommands' });

export { buildSlashCommands, registerSlashCommands } from './commands/_shared.js';
export type { SlashCommandDependencies } from './commands/_shared.js';

export async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  deps: SlashCommandDependencies,
): Promise<void> {
  const { commandName } = interaction;

  try {
    switch (commandName) {
      case 'help':    await handleHelp(interaction); break;
      case 'status':  await handleStatus(interaction, deps); break;
      case 'reset':   await handleReset(interaction, deps); break;
      case 'model':   await handleModel(interaction, deps); break;
      case 'cost':    await handleCost(interaction, deps); break;
      case 'stop':    await handleStop(interaction, deps); break;
      case 'close':   await handleClose(interaction, deps); break;
      case 'sync':    await handleSync(interaction, deps); break;
      case 'ctx':     await handleCtx(interaction, deps); break;
      case 'cache':   await handleCache(interaction, deps); break;
      case 'restart': await handleRestart(interaction); break;
      case 'sessions': await handleSessions(interaction, deps); break;
      default:
        await interaction.reply({ content: `未知指令：/${commandName}`, ephemeral: true });
    }
  } catch (error) {
    log.error({ error, commandName }, 'Slash command error');
    const msg = error instanceof Error ? error.message : String(error);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: `❌ 錯誤：${msg}`, ephemeral: true });
      } else {
        await interaction.reply({ content: `❌ 錯誤：${msg}`, ephemeral: true });
      }
    } catch {
      // Interaction may have expired
    }
  }
}
