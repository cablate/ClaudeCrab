/**
 * Local Sound Player
 *
 * Plays audio files locally for notifications.
 * Uses PowerShell with hidden window on Windows to avoid CMD popup.
 */

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { logger } from './logger.js';

/**
 * Play a local sound file.
 * Fails silently with warning if file doesn't exist or playback fails.
 */
export async function playSound(filePath: string): Promise<void> {
  // Only works on Windows
  if (process.platform !== 'win32') {
    return;
  }

  if (!filePath) {
    return;
  }

  if (!existsSync(filePath)) {
    logger.warn({ filePath }, '[LocalSound] Sound file not found');
    return;
  }

  try {
    // Use PowerShell with hidden window to play sound without CMD popup
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        `(New-Object Media.SoundPlayer '${filePath.replace(/'/g, "''")}').PlaySync()`,
      ],
      {
        stdio: 'ignore',
        windowsHide: true,
      }
    );

    // Don't detach - let it run in background but keep reference
    child.on('error', (err) => {
      logger.warn({ error: err, filePath }, '[LocalSound] Spawn error');
    });

    logger.debug({ filePath }, '[LocalSound] Sound spawned');
  } catch (error) {
    logger.warn({ error, filePath }, '[LocalSound] Failed to play sound');
  }
}
