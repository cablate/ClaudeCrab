/**
 * Groq Whisper STT provider.
 *
 * Uses Groq's OpenAI-compatible audio transcription endpoint.
 * Supports OGG, MP3, WAV, FLAC, M4A, WebM, MPEG.
 */

import { retryAsync, API_RETRY_OPTIONS, isRateLimitError, isTransientError } from '../../utils/retry.js';
import { STTError } from '../../types/errors.js';
import type { STTProvider, TranscribeOptions, TranscribeResult } from './types.js';

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-large-v3-turbo';

interface GroqTranscriptionResponse {
  text: string;
  language?: string;
  duration?: number;
}

export class GroqSTTProvider implements STTProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model ?? DEFAULT_MODEL;
  }

  async transcribe(audio: Buffer, options?: TranscribeOptions): Promise<TranscribeResult> {
    const fileName = options?.fileName ?? 'voice.ogg';

    return retryAsync(
      async () => {
        const formData = new FormData();
        formData.append('file', new Blob([new Uint8Array(audio)]), fileName);
        formData.append('model', this.model);
        formData.append('response_format', 'verbose_json');

        if (options?.language !== undefined) {
          formData.append('language', options.language);
        }

        const response = await fetch(GROQ_TRANSCRIPTION_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: formData,
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new STTError(
            `Groq STT API error: ${response.status} ${response.statusText} — ${body}`,
          );
        }

        const data = (await response.json()) as GroqTranscriptionResponse;

        if (!data.text || data.text.trim().length === 0) {
          throw new STTError('Groq STT returned empty transcription');
        }

        return {
          text: data.text.trim(),
          language: data.language,
          duration: data.duration,
        };
      },
      {
        ...API_RETRY_OPTIONS,
        maxAttempts: 2,
        isRetryable: (err) => isRateLimitError(err) || isTransientError(err),
      },
    );
  }
}
