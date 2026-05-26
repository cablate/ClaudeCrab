/**
 * Text-to-Speech provider interface and types.
 *
 * Designed for provider-agnostic speech synthesis (Replicate MiniMax, OpenAI TTS, etc.).
 */

export interface TTSProvider {
  synthesize(text: string, options?: SynthesizeOptions): Promise<SynthesizeResult>;
}

export interface SynthesizeOptions {
  /** Voice ID or name for the TTS model. */
  voiceId?: string;
  /** Speaking speed (0.5 - 2.0, default 1.0). */
  speed?: number;
  /** BCP-47 language code hint. */
  language?: string;
  /** Audio output format (default 'mp3'). */
  audioFormat?: 'mp3' | 'wav';
}

export interface SynthesizeResult {
  /** Audio data as Buffer. */
  audio: Buffer;
  /** Audio duration in seconds (if available). */
  duration?: number | undefined;
  /** MIME type of the audio. */
  mimeType: string;
  /** File extension without dot. */
  extension: string;
}

export interface TTSConfig {
  provider: 'replicate';
  apiToken: string;
  model?: string;
  defaultVoiceId?: string;
}
