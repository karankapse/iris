import type { Emotion, SpeakOptions, TtsProvider } from '../../../contracts';
import { EMOTION_PROFILES } from './emotionProfiles';

/**
 * The free "mock" voice: the browser's built-in speechSynthesis, with rate/pitch/volume
 * adjusted per emotion. It's flat compared to a real expressive voice, but it's enough to
 * hear the difference between tones and to build the whole app around.
 */
export class BrowserTts implements TtsProvider {
  speak(text: string, emotion: Emotion, options: SpeakOptions = {}): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        console.warn('[tts] speechSynthesis is not available in this browser');
        resolve();
        return;
      }
      window.speechSynthesis.cancel(); // never overlap two replies
      const profile = EMOTION_PROFILES[emotion];
      const utterance = new SpeechSynthesisUtterance(text);
      // The user's speed setting scales the tone's own rate (limits of speechSynthesis: 0.1 to 10).
      utterance.rate = Math.min(10, Math.max(0.1, profile.rate * (options.speed ?? 1)));
      utterance.pitch = profile.pitch;
      utterance.volume = profile.volume;
      // Resolve on both normal end and errors (cancel() triggers an 'interrupted' error).
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  }

  cancel() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
}
