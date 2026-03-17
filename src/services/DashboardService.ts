/**
 * Re-export from new location for backward compatibility.
 * DashboardService is now DiscordDashboard in adapters/discord/services/.
 */
export { DiscordDashboard as DashboardService } from '../adapters/discord/services/DiscordDashboard.js';
export type { DiscordDashboardOptions as DashboardServiceOptions } from '../adapters/discord/services/DiscordDashboard.js';
