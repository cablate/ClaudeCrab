/**
 * Replicate MiniMax Speech 2.8 Turbo TTS provider.
 *
 * Uses Replicate API to run minimax/speech-2.6-hd model.
 * Returns MP3 audio buffer.
 */

import Replicate from 'replicate';
import { retryAsync, API_RETRY_OPTIONS, isRateLimitError, isTransientError } from '../../utils/retry.js';
import { TTSError } from '../../types/errors.js';
import type { TTSProvider, SynthesizeOptions, SynthesizeResult } from './types.js';

const DEFAULT_MODEL = 'minimax/speech-2.8-turbo';

export class ReplicateTTSProvider implements TTSProvider {
  private readonly replicate: Replicate;
  private readonly model: `${string}/${string}`;
  private readonly defaultVoiceId: string | undefined;

  constructor(apiToken: string, model?: string, defaultVoiceId?: string) {
    this.replicate = new Replicate({ auth: apiToken });
    this.model = (model ?? DEFAULT_MODEL) as `${string}/${string}`;
    this.defaultVoiceId = defaultVoiceId;
  }

  async synthesize(text: string, options?: SynthesizeOptions): Promise<SynthesizeResult> {
    if (!text || text.trim().length === 0) {
      throw new TTSError('Text to synthesize cannot be empty');
    }

    // Determine audio format (default to wav for better compatibility)
    const audioFormat = options?.audioFormat ?? 'wav';

    return retryAsync(
      async () => {
        const input: Record<string, unknown> = {
          text: text.trim(),
          audio_format: audioFormat,
        };

        // Apply optional parameters
        if (options?.voiceId ?? this.defaultVoiceId) {
          input.voice_id = options?.voiceId ?? this.defaultVoiceId;
        }
        if (options?.speed !== undefined) {
          input.speed = options.speed;
        }

        // Run the model
        const output = await this.replicate.run(this.model, { input });

        // Convert output to Buffer
        const audioBuffer = await this.outputToBuffer(output);

        if (audioBuffer.length === 0) {
          throw new TTSError('Replicate TTS returned empty audio');
        }

        // Return with correct mime type and extension based on format
        const mimeType = audioFormat === 'wav' ? 'audio/wav' : 'audio/mpeg';
        const extension = audioFormat;

        return {
          audio: audioBuffer,
          mimeType,
          extension,
        };
      },
      {
        ...API_RETRY_OPTIONS,
        maxAttempts: 2,
        isRetryable: (err) => isRateLimitError(err) || isTransientError(err),
      },
    );
  }

  private async outputToBuffer(output: unknown): Promise<Buffer> {
    // Replicate returns a FileOutput object with url() method
    if (!output || typeof output !== 'object') {
      throw new TTSError('Replicate TTS returned invalid output');
    }

    // Handle ReadableStream
    if (output instanceof ReadableStream) {
      const chunks: Uint8Array[] = [];
      const reader = output.getReader();
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (result.value) {
          chunks.push(result.value);
        }
      }
      return Buffer.concat(chunks);
    }

    // Handle Buffer directly
    if (Buffer.isBuffer(output)) {
      return output;
    }

    // Handle ArrayBuffer/TypedArray
    if (ArrayBuffer.isView(output)) {
      return Buffer.from(output.buffer, output.byteOffset, output.byteLength);
    }

    // Handle FileOutput object - fetch from URL
    const fileOutput = output as { url?: () => string };
    if (typeof fileOutput.url === 'function') {
      const url = fileOutput.url();
      const response = await fetch(url);
      if (!response.ok) {
        throw new TTSError(`Failed to download audio: ${response.status}`);
      }
      return Buffer.from(await response.arrayBuffer());
    }

    throw new TTSError('Unexpected Replicate output format');
  }
}
