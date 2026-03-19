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

function cleanupPid() {
  try { unlinkSync(PID_FILE); } catch { /* already removed */ }
}
process.on('exit', cleanupPid);

let child: ChildProcess | null = null;
let backoff = 0;
let stopping = false;
let startTime = 0;

function log(msg: string) {
  const line = `${new Date().toISOString()} [supervisor] ${msg}\n`;
  process.stdout.write(line);
  try { appendFileSync(OUT_LOG, line); } catch { /* best-effort */ }
}

function startChild() {
  startTime = Date.now();
  log(`Starting ClaudeCab (backoff=${backoff}ms)`);

  child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: resolve(import.meta.dirname),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' },
    windowsHide: true,
  });

  // Pipe stdout/stderr to log files (append mode)
  child.stdout?.on('data', (chunk: Buffer) => {
    try { appendFileSync(OUT_LOG, chunk); } catch { /* */ }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    try { appendFileSync(ERR_LOG, chunk); } catch { /* */ }
  });

  child.on('exit', (code, signal) => {
    const uptime = Date.now() - startTime;
    log(`Child exited: code=${code} signal=${signal} uptime=${uptime}ms`);

    if (stopping) {
      log('Supervisor stopping — no restart');
      process.exit(code ?? 0);
      return;
    }

    // Reset backoff if process was stable
    if (uptime > STABLE_THRESHOLD) {
      backoff = 0;
    }

    if (code === 0) {
      // Graceful restart (from /restart command) — restart immediately
      log('Graceful restart requested');
      startChild();
    } else {
      // Crash — restart with backoff
      backoff = backoff === 0 ? 1000 : Math.min(backoff * 2, MAX_BACKOFF);
      log(`Crash detected, restarting in ${backoff}ms`);
      setTimeout(startChild, backoff);
    }
  });

  // Send ready signal for PM2 compatibility (ignored when not under PM2)
  if (typeof process.send === 'function') {
    setTimeout(() => process.send?.('ready'), 5000);
  }
}

// Windows: ignore console close events (SIGHUP / CTRL_CLOSE_EVENT).
// node.exe is a console app — even when the window is hidden, the console exists.
// Windows sends CTRL_CLOSE_EVENT when the console session ends, which kills the
// entire process tree with STATUS_CONTROL_C_EXIT (0xC000013A).
// By handling SIGHUP, we prevent the automatic exit.
process.on('SIGHUP', () => {
  log('Console close event (SIGHUP) received — ignoring (running as background service)');
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
