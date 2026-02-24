/**
 * TTS Service
 *
 * Manages text-to-speech generation, file storage, and playback.
 * Provides a unified interface for TTS operations across the application.
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from '../utils/logger.js';
import { playSound } from '../utils/localSound.js';
import type { TTSProvider, SynthesizeOptions } from '../core/tts/types.js';

/** Default TTS output directory */
const DEFAULT_TTS_DIR = resolve(process.cwd(), 'temp', 'tts');

/** Maximum age for TTS files before cleanup (1 hour) */
const MAX_FILE_AGE_MS = 60 * 60 * 1000;

/** Maximum number of TTS files to keep */
const MAX_FILES = 50;

export interface TTSServiceOptions {
  /** TTS provider instance */
  provider: TTSProvider;
  /** Output directory for TTS files (default: temp/tts) */
  outputDir?: string;
  /** Default voice ID */
  defaultVoiceId?: string;
  /** Default language */
  defaultLanguage?: string;
}

export interface SpeakOptions {
  /** Voice ID override */
  voiceId?: string;
  /** Language override */
  language?: string;
  /** Speech speed (0.5-2.0) */
  speed?: number;
  /** Whether to play locally after generation */
  playLocal?: boolean;
  /** Custom filename (without extension) */
  filename?: string;
}

export interface SpeakResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Path to the generated audio file */
  filePath?: string;
  /** Error message if failed */
  error?: string;
  /** Audio duration in seconds */
  duration?: number;
}

/**
 * TTS Service for managing text-to-speech operations.
 */
export class TTSService {
  private readonly provider: TTSProvider;
  private readonly outputDir: string;
  private readonly defaultVoiceId: string | undefined;
  private readonly defaultLanguage: string | undefined;

  constructor(options: TTSServiceOptions) {
    this.provider = options.provider;
    this.outputDir = options.outputDir ?? DEFAULT_TTS_DIR;
    this.defaultVoiceId = options.defaultVoiceId;
    this.defaultLanguage = options.defaultLanguage ?? 'Chinese';

    // Ensure output directory exists
    this.ensureOutputDir();
  }

  /**
   * Generate speech from text and optionally play it locally.
   */
  async speak(text: string, options?: SpeakOptions): Promise<SpeakResult> {
    if (!text || text.trim().length === 0) {
      return { success: false, error: 'Empty text provided' };
    }

    try {
      // Generate speech
      const synthesizeOpts: SynthesizeOptions = {};
      const voiceId = options?.voiceId ?? this.defaultVoiceId;
      if (voiceId !== undefined) synthesizeOpts.voiceId = voiceId;
      const language = options?.language ?? this.defaultLanguage;
      if (language !== undefined) synthesizeOpts.language = language;
      // Fixed speed at 1.2x for faster playback
      synthesizeOpts.speed = 1.2;

      const result = await this.provider.synthesize(text, synthesizeOpts);

      // Generate filename
      const timestamp = Date.now();
      const filename = options?.filename ?? `tts_${timestamp}`;
      const filePath = join(this.outputDir, `${filename}.${result.extension}`);

      // Write to file
      writeFileSync(filePath, result.audio);
      logger.info({ filePath, textLength: text.length }, '[TTSService] Audio file saved');

      // Play locally if requested
      if (options?.playLocal !== false) {
        await this.playLocal(filePath);
      }

      // Cleanup old files (non-blocking)
      this.cleanupOldFiles().catch(() => {});

      const speakResult: SpeakResult = {
        success: true,
        filePath,
      };
      if (result.duration !== undefined) {
        speakResult.duration = result.duration;
      }
      return speakResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error, text: text.substring(0, 100) }, '[TTSService] Failed to generate speech');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Play an audio file locally.
   */
  async playLocal(filePath: string): Promise<void> {
    try {
      await playSound(filePath);
      logger.debug({ filePath }, '[TTSService] Audio played locally');
    } catch (error) {
      logger.warn({ error, filePath }, '[TTSService] Failed to play audio locally');
    }
  }

  /**
   * Get the output directory path.
   */
  getOutputDir(): string {
    return this.outputDir;
  }

  /**
   * Ensure the output directory exists.
   */
  private ensureOutputDir(): void {
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
      logger.info({ outputDir: this.outputDir }, '[TTSService] Created output directory');
    }
  }

  /**
   * Clean up old TTS files to prevent disk space issues.
   */
  private async cleanupOldFiles(): Promise<void> {
    try {
      const files = readdirSync(this.outputDir)
        .filter(f => f.startsWith('tts_'))
        .map(f => ({
          name: f,
          path: join(this.outputDir, f),
          mtime: statSync(join(this.outputDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.mtime - a.mtime); // Newest first

      const now = Date.now();
      let deletedCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const age = now - file.mtime;

        // Delete if too old or if we have too many files
        if (age > MAX_FILE_AGE_MS || i >= MAX_FILES) {
          try {
            unlinkSync(file.path);
            deletedCount++;
          } catch {
            // Ignore deletion errors (file might be in use)
          }
        }
      }

      if (deletedCount > 0) {
        logger.debug({ deletedCount }, '[TTSService] Cleaned up old TTS files');
      }
    } catch (error) {
      logger.warn({ error }, '[TTSService] Failed to cleanup old files');
    }
  }
}
