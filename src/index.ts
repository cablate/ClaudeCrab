import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { logger } from './utils/logger.js';
import { loadAppConfig } from './config.js';
import { AppBootstrap } from './AppBootstrap.js';
import { CRASH_MARKER_PATH } from './constants.js';

// Windows: ignore console close events (CTRL_CLOSE_EVENT → SIGHUP in Node.js).
// Without this handler, Windows kills the process with STATUS_CONTROL_C_EXIT (0xC000013A)
// when the hidden console session ends. The supervisor manages process lifecycle instead.
// Linux/macOS: SIGHUP has different semantics (terminal disconnect / config reload);
// no CTRL_CLOSE_EVENT issue exists, so this handler is Windows-only.
if (process.platform === 'win32') {
  process.on('SIGHUP', () => {
    logger.info('Console close event (SIGHUP) — ignoring (supervisor manages lifecycle)');
  });
}

// Global error handlers — prevent silent crashes under PM2
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  try {
    writeFileSync(CRASH_MARKER_PATH, JSON.stringify({
      time: new Date().toISOString(),
      error: err.message,
      stack: err.stack,
    }));
  } catch { /* best-effort */ }
  process.exit(1);
});

const app = new AppBootstrap(loadAppConfig());

app.start().catch((error: unknown) => {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.fatal({ err, message: err.message }, 'Failed to start ClaudeCab');
  process.exit(1);
});

process.on('SIGINT', () => {
  void app.shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void app.shutdown('SIGTERM');
});
