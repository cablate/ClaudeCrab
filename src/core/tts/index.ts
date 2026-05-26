/**
 * TTS module — text-to-speech provider factory.
 */

export type { TTSProvider, TTSConfig, SynthesizeOptions, SynthesizeResult } from './types.js';
export { ReplicateTTSProvider } from './ReplicateTTSProvider.js';

import type { TTSConfig, TTSProvider } from './types.js';
import { ReplicateTTSProvider } from './ReplicateTTSProvider.js';

export function createTTSProvider(config: TTSConfig): TTSProvider {
  switch (config.provider) {
    case 'replicate':
      return new ReplicateTTSProvider(config.apiToken, config.model, config.defaultVoiceId);
    default:
      throw new Error(`Unknown TTS provider: ${String(config.provider)}`);
  }
}
