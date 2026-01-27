export { BaseAdapter } from './BaseAdapter.js';
export { TelegramAdapter } from './TelegramAdapter.js';
export type {
  UnifiedMessage,
  MessageMetadata,
  SendOptions,
  SendResult,
  AdapterState,
  MessageHandler,
  AdapterConfig,
  RateLimitConfig,
  TelegramAdapterConfig,
} from './types.js';
export { DEFAULT_RATE_LIMIT } from './types.js';

// Command handlers
export {
  COMMAND_HANDLERS,
  handleStart,
  handleHelp,
  handleList,
  handleSwitch,
  handleReset,
  type CommandDependencies,
  type CommandHandler,
} from './commands/index.js';
