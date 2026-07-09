/**
 * Local Sound Player
 *
 * Plays audio files locally for notifications.
 * Uses PowerShell with hidden window on Windows to avoid CMD popup.
 */

import { existsSync } from 'node:fs';
import { extname } from 'node:path';
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

  const ext = extname(filePath).toLowerCase();

  // WAV files: use Media.SoundPlayer (works perfectly, no popup)
  if (ext === '.wav') {
    return new Promise<void>((resolve) => {
      try {
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

        child.on('error', (err) => {
          logger.warn({ error: err, filePath }, '[LocalSound] Spawn error for WAV');
          resolve();
        });

        child.on('close', () => {
          logger.debug({ filePath }, '[LocalSound] WAV playback finished');
          resolve();
        });

        logger.debug({ filePath }, '[LocalSound] WAV playback spawned');
      } catch (error) {
        logger.warn({ error, filePath }, '[LocalSound] Failed to play WAV');
        resolve();
      }
    });
  }

  // MP3/M4A/OGG/FLAC: use .NET MediaPlayer (may not work on all systems)
  if (ext === '.mp3' || ext === '.m4a' || ext === '.ogg' || ext === '.flac') {
    return new Promise<void>((resolve) => {
      try {
        const psScript = `
Add-Type -AssemblyName PresentationCore
$mp = New-Object System.Windows.Media.MediaPlayer
$mp.Open([Uri]'${filePath.replace(/'/g, "''")}')
$mp.Play()
Start-Sleep -Milliseconds 500
while ($mp.Position -lt $mp.NaturalDuration.TimeSpan -and $mp.NaturalDuration.HasTimeSpan) { Start-Sleep -Milliseconds 100 }
Start-Sleep -Milliseconds 100
$mp.Close()
`;
        const child = spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-WindowStyle',
            'Hidden',
            '-Command',
            psScript,
          ],
          {
            stdio: 'ignore',
            windowsHide: true,
          }
        );

        child.on('error', (err) => {
          logger.warn({ error: err, filePath }, '[LocalSound] Spawn error for MP3');
          resolve();
        });

        child.on('close', () => {
          logger.debug({ filePath }, '[LocalSound] MP3 playback finished');
          resolve();
        });

        logger.debug({ filePath }, '[LocalSound] MP3 playback spawned');
      } catch (error) {
        logger.warn({ error, filePath }, '[LocalSound] Failed to play MP3');
        resolve();
      }
    });
  }

  // Unsupported format
  logger.warn({ filePath, ext }, '[LocalSound] Unsupported audio format');
}
