/**
 * Speech-to-Text provider interface and types.
 *
 * Designed for provider-agnostic transcription (Groq Whisper, xAI STT, etc.).
 */

export interface STTProvider {
  transcribe(audio: Buffer, options?: TranscribeOptions): Promise<TranscribeResult>;
}

export interface TranscribeOptions {
  /** BCP-47 language code, e.g. 'zh', 'en'. Auto-detected if omitted. */
  language?: string;
  /** File name with extension (some APIs require this for format detection). */
  fileName?: string;
}

export interface TranscribeResult {
  /** Transcribed text. */
  text: string;
  /** Detected language (BCP-47). */
  language?: string | undefined;
  /** Audio duration in seconds. */
  duration?: number | undefined;
}

export interface STTConfig {
  provider: 'groq';
  apiKey: string;
  model?: string;
}
