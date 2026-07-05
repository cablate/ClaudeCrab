import { spawn } from 'node:child_process';

export interface AdminCommandResult {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

const OUTPUT_LIMIT = 20_000;

export function runAdminCommand(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<AdminCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    const label = [command, ...args].join(' ');
    const stdout: string[] = [];
    const stderr: string[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs);
    timer.unref();

    child.stdout?.on('data', (chunk: Buffer) => {
      appendLimited(stdout, chunk.toString('utf-8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      appendLimited(stderr, chunk.toString('utf-8'));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        command: label,
        exitCode: 1,
        timedOut,
        stdout: joinLimited(stdout),
        stderr: joinLimited([...stderr, error.message]),
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        command: label,
        exitCode: code,
        timedOut,
        stdout: joinLimited(stdout),
        stderr: joinLimited(stderr),
      });
    });
  });
}

export function runNpmCommand(args: string[], options: { cwd: string; timeoutMs: number }): Promise<AdminCommandResult> {
  return runAdminCommand('npm', args, options);
}

function appendLimited(target: string[], value: string): void {
  target.push(value);
  while (target.join('').length > OUTPUT_LIMIT) {
    target.shift();
  }
}

function joinLimited(parts: string[]): string {
  const joined = parts.join('');
  return joined.length > OUTPUT_LIMIT ? joined.slice(-OUTPUT_LIMIT) : joined;
}
