import 'dotenv/config';
import { logger } from './utils/logger.js';
import { loadAppConfig } from './config.js';
import { AppBootstrap } from './AppBootstrap.js';

const app = new AppBootstrap(loadAppConfig());

app.start().catch((error: unknown) => {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.fatal({ err, message: err.message }, 'Failed to start ClaudeCab');
  console.error('Startup error:', err.message);
  process.exit(1);
});

process.on('SIGINT', () => {
  void app.shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void app.shutdown('SIGTERM');
});
