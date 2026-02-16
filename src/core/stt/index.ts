/**
 * STT module — speech-to-text provider factory.
 */

export type { STTProvider, STTConfig, TranscribeOptions, TranscribeResult } from './types.js';
export { GroqSTTProvider } from './GroqSTTProvider.js';

import type { STTConfig, STTProvider } from './types.js';
import { GroqSTTProvider } from './GroqSTTProvider.js';

export function createSTTProvider(config: STTConfig): STTProvider {
  switch (config.provider) {
    case 'groq':
      return new GroqSTTProvider(config.apiKey, config.model);
    default:
      throw new Error(`Unknown STT provider: ${String(config.provider)}`);
  }
}
