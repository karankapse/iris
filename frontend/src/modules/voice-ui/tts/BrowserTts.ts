import type { Emotion, TtsProvider } from '../../../contracts';
import { EMOTION_PROFILES } from './emotionProfiles';

/**
 * The free "mock" voice: the browser's built-in speechSynthesis, with rate/pitch/volume
 * adjusted per emotion. It's flat compared to a real expressive voice, but it's enough to
 * hear the difference between tones and to build the whole app around.
 */
export class BrowserTts implements TtsProvider {
  speak(text: string, emotion: Emotion): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        console.warn('[tts] speechSynthesis is not available in this browser');
        resolve();
        return;
      }
      window.speechSynthesis.cancel(); // never overlap two replies
      const profile = EMOTION_PROFILES[emotion];
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = profile.rate;
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
