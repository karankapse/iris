import type { TtsProvider } from '../../../contracts';
import { BrowserTts } from './BrowserTts';
import { SilentTts } from './SilentTts';

export { BrowserTts, SilentTts };
export { EMOTION_PROFILES } from './emotionProfiles';

/**
 * Add a new provider (e.g. an expressive cloud TTS) by implementing `TtsProvider`
 * and adding a case here; then set VITE_TTS_PROVIDER in `.env`.
 */
export function createTts(provider: 'browser' | 'silent'): TtsProvider {
  return provider === 'silent' ? new SilentTts() : new BrowserTts();
}
