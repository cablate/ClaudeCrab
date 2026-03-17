/**
 * Re-export from new location for backward compatibility.
 * CostReportService is now DiscordCostReport in adapters/discord/services/.
 */
export { DiscordCostReport as CostReportService } from '../adapters/discord/services/DiscordCostReport.js';
export type { DiscordCostReportOptions as CostReportServiceOptions } from '../adapters/discord/services/DiscordCostReport.js';
