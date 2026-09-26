import type { TtsProvider } from '../../../contracts';
import { BrowserTts } from './BrowserTts';
import { ClonedTts } from './ClonedTts';
import { SilentTts } from './SilentTts';

export { BrowserTts, ClonedTts, SilentTts };
export { EMOTION_PROFILES } from './emotionProfiles';

/**
 * Creates TTS provider. By default, ClonedTts is used to support ElevenLabs
 * voice cloning with automatic BrowserTts fallback.
 */
export function createTts(provider: 'browser' | 'silent' | 'cloned'): TtsProvider {
  if (provider === 'silent') return new SilentTts();
  // By default, use ClonedTts which calls ElevenLabs if a voice is active,
  // and automatically falls back to BrowserTts if not configured or offline.
  return new ClonedTts(new BrowserTts());
}
