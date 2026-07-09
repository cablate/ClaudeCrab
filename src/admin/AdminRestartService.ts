import { logger } from '../utils/logger.js';
import { runNpmCommand, type AdminCommandResult } from './AdminCommandRunner.js';

const log = logger.child({ module: 'AdminRestartService' });

export interface RestartRequestOptions {
  source: 'discord' | 'admin-console';
  userId?: string;
  cwd?: string;
  buildCheckEnabled?: boolean;
}

export interface RestartRequestResult {
  ok: boolean;
  build?: AdminCommandResult;
  message: string;
}

export async function requestProcessRestart(options: RestartRequestOptions): Promise<RestartRequestResult> {
  const cwd = options.cwd ?? process.cwd();
  const buildCheckEnabled = options.buildCheckEnabled ?? true;

  if (buildCheckEnabled) {
    const build = await runNpmCommand(['run', 'build'], { cwd, timeoutMs: 120_000 });
    if (build.exitCode !== 0 || build.timedOut) {
      log.error(
        { source: options.source, userId: options.userId, exitCode: build.exitCode, timedOut: build.timedOut },
        'Build check failed, aborting restart',
      );
      return {
        ok: false,
        build,
        message: build.timedOut ? 'Build check timed out.' : 'Build check failed.',
      };
    }
    scheduleExit(options);
    return { ok: true, build, message: 'Build passed. Restart scheduled.' };
  }

  scheduleExit(options);
  return { ok: true, message: 'Restart scheduled.' };
}

function scheduleExit(options: RestartRequestOptions): void {
  log.info({ source: options.source, userId: options.userId }, 'Graceful restart requested');
  const timer = setTimeout(() => {
    log.info({ source: options.source }, 'Exiting for supervisor-managed restart');
    process.exit(0);
  }, 1000);
  timer.unref();
}
