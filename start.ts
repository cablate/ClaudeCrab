/**
 * Process supervisor — replaces PM2 daemon for Windows stability.
 *
 * Spawns src/index.ts as a child process and auto-restarts on exit.
 * - exit 0 (graceful restart via /restart command) → restart immediately
 * - exit 1 (crash) → restart with exponential backoff (1s → 2s → 4s, max 30s)
 * - SIGINT/SIGTERM → forward to child, then exit (no restart)
 *
 * Usage: node --import tsx start.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MAX_BACKOFF = 30_000;
const STABLE_THRESHOLD = 30_000; // running > 30s resets backoff
const LOG_DIR = resolve(import.meta.dirname, 'logs');
const OUT_LOG = resolve(LOG_DIR, 'supervisor-out.log');
const ERR_LOG = resolve(LOG_DIR, 'supervisor-error.log');

const PID_FILE = resolve(import.meta.dirname, 'claudecab.pid');
const STATE_FILE = resolve(import.meta.dirname, 'claudecab.runtime.json');
const CONTROL_FILE = resolve(import.meta.dirname, 'claudecab.control.json');
const supervisorStartedAt = new Date().toISOString();

mkdirSync(LOG_DIR, { recursive: true });

// Guard: prevent duplicate instances
if (existsSync(PID_FILE)) {
  const oldPid = parseInt(readFileSync(PID_FILE, 'utf8').trim());
  try {
    process.kill(oldPid, 0); // check if alive
    console.error(`Another instance is already running (PID ${oldPid}). Exiting.`);
    process.exit(1);
  } catch {
    // Stale PID file — previous process died without cleanup
  }
}

// Write PID file
writeFileSync(PID_FILE, String(process.pid));

let child: ChildProcess | null = null;
let backoff = 0;
let stopping = false;
let restartRequested = false;
let startTime = 0;

function writeRuntimeState(extra: Record<string, unknown> = {}) {
  const state = {
    supervisorPid: process.pid,
    supervisorStartedAt,
    childPid: child?.pid ?? null,
    childStartedAt: startTime > 0 ? new Date(startTime).toISOString() : null,
    stopping,
    backoffMs: backoff,
    updatedAt: new Date().toISOString(),
    ...extra,
  };

  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    /* best-effort observability */
  }
}

function cleanupPid() {
  try { unlinkSync(PID_FILE); } catch { /* already removed */ }
  writeRuntimeState({ status: 'stopped', childPid: null });
}
process.on('exit', cleanupPid);

function log(msg: string) {
  const line = `${new Date().toISOString()} [supervisor] ${msg}\n`;
  process.stdout.write(line);
  try { appendFileSync(OUT_LOG, line); } catch { /* best-effort */ }
}

function startChild() {
  startTime = Date.now();
  restartRequested = false;
  log(`Starting ClaudeCab (backoff=${backoff}ms)`);

  child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: resolve(import.meta.dirname),
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' },
    windowsHide: true,
  });
  writeRuntimeState({ status: 'child_started' });

  // child stdout 由 pino-roll 直接寫 logs/claudecab.*.log,不在此重複落檔。
  // stderr 仍接住 — child crash 的 stack trace 不會進 pino,只能從 stderr 抓。
  child.stderr?.on('data', (chunk: Buffer) => {
    try { appendFileSync(ERR_LOG, chunk); } catch { /* */ }
  });

  child.on('exit', (code, signal) => {
    const uptime = Date.now() - startTime;
    log(`Child exited: code=${code} signal=${signal} uptime=${uptime}ms`);
    writeRuntimeState({
      status: 'child_exited',
      childExitCode: code,
      childExitSignal: signal,
      childUptimeMs: uptime,
    });

    if (stopping) {
      log('Supervisor stopping — no restart');
      process.exit(code ?? 0);
      return;
    }

    if (restartRequested) {
      log('Runtime control restart requested');
      writeRuntimeState({ status: 'runtime_control_restart_requested' });
      startChild();
      return;
    }

    // Reset backoff if process was stable
    if (uptime > STABLE_THRESHOLD) {
      backoff = 0;
    }

    if (code === 0) {
      // Graceful restart (from /restart command) — restart immediately
      log('Graceful restart requested');
      writeRuntimeState({ status: 'graceful_restart_requested' });
      startChild();
    } else {
      // Crash — restart with backoff
      backoff = backoff === 0 ? 1000 : Math.min(backoff * 2, MAX_BACKOFF);
      log(`Crash detected, restarting in ${backoff}ms`);
      writeRuntimeState({ status: 'restart_scheduled' });
      setTimeout(startChild, backoff);
    }
  });
}

function readControlCommand(): 'stop' | 'restart' | null {
  if (!existsSync(CONTROL_FILE)) return null;

  try {
    const payload = JSON.parse(readFileSync(CONTROL_FILE, 'utf8')) as { command?: unknown };
    return payload.command === 'stop' || payload.command === 'restart' ? payload.command : null;
  } catch {
    return null;
  } finally {
    try { unlinkSync(CONTROL_FILE); } catch { /* best-effort */ }
  }
}

function handleControlCommand(command: 'stop' | 'restart') {
  if (command === 'stop') {
    log('Runtime control stop requested');
    stopping = true;
    writeRuntimeState({ status: 'runtime_control_stopping' });
    child?.kill('SIGTERM');
    return;
  }

  log('Runtime control restart requested');
  restartRequested = true;
  writeRuntimeState({ status: 'runtime_control_restarting' });
  child?.kill('SIGTERM');
}

setInterval(() => {
  const command = readControlCommand();
  if (command) handleControlCommand(command);
}, 1000).unref();

// Windows: ignore console close events (SIGHUP / CTRL_CLOSE_EVENT).
// node.exe is a console app — even when the window is hidden, the console exists.
// Windows sends CTRL_CLOSE_EVENT when the console session ends, which kills the
// entire process tree with STATUS_CONTROL_C_EXIT (0xC000013A).
// By handling SIGHUP, we prevent the automatic exit.
process.on('SIGHUP', () => {
  log('Console close event (SIGHUP) received — ignoring (running as background service)');
  writeRuntimeState({ status: 'sighup_ignored' });
});

// Catch supervisor-level crashes so we know WHY it dies
process.on('uncaughtException', (err) => {
  log(`FATAL uncaughtException: ${err.message}\n${err.stack}`);
  try { appendFileSync(ERR_LOG, `${new Date().toISOString()} [supervisor] uncaughtException: ${err.stack}\n`); } catch { /* */ }
  // Don't exit — keep supervising
});
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  log(`WARN unhandledRejection: ${msg}`);
  try { appendFileSync(ERR_LOG, `${new Date().toISOString()} [supervisor] unhandledRejection: ${msg}\n`); } catch { /* */ }
});

// Forward signals to child
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log(`Received ${sig} — forwarding to child and stopping`);
    stopping = true;
    writeRuntimeState({ status: 'stopping', signal: sig });
    child?.kill(sig);
    // If child doesn't exit in 10s, force kill
    setTimeout(() => {
      log('Force killing child after timeout');
      child?.kill('SIGKILL');
      process.exit(1);
    }, 10_000);
  });
}

startChild();
