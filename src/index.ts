import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { logger } from './utils/logger.js';
import { formatRuntimeConfigIssues, loadAppConfig, validateAppConfigForRuntime } from './config.js';
import { AppBootstrap } from './AppBootstrap.js';
import { CRASH_MARKER_PATH } from './constants.js';

// Instance lock: bind localhost port to prevent duplicate bot instances.
// If another ClaudeCab is already running, EADDRINUSE fires and we exit(1)
// before any Discord connection is made. The OS releases the port
// automatically when the process dies, so no stale-lock cleanup is needed.
const INSTANCE_LOCK_PORT = 47823;
const lockServer = createServer();
lockServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.fatal(
      { event_type: 'instance.lock_failed', port: INSTANCE_LOCK_PORT, reason: 'EADDRINUSE' },
      'Another ClaudeCab instance is already running (instance lock port in use). Exiting to prevent duplicate message processing.'
    );
    process.exit(1);
  }
  logger.fatal({ event_type: 'instance.lock_failed', err }, 'Instance lock server failed');
  process.exit(1);
});
lockServer.listen(INSTANCE_LOCK_PORT, '127.0.0.1', () => {
  logger.info({ event_type: 'instance.lock_acquired', port: INSTANCE_LOCK_PORT }, 'Instance lock acquired');
});

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

// Global error handlers — prevent silent crashes under the supervisor
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

const config = loadAppConfig();
const configValidation = validateAppConfigForRuntime(config);
if (!configValidation.ok) {
  const message = formatRuntimeConfigIssues(configValidation.issues);
  logger.fatal({ event_type: 'config.validation_failed', issues: configValidation.issues }, message);
  process.exit(1);
}

const app = new AppBootstrap(config);

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
