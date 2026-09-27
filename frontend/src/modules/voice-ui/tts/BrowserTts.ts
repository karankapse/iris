import type { Emotion, SpeakOptions, TtsProvider } from '../../../contracts';
import { EMOTION_PROFILES, type VoiceProfile } from './emotionProfiles';
import { planSpeech, type SpeechChunk } from './prosody';
import { preferredVoice } from './voices';

/**
 * The free voice: the browser's built-in speechSynthesis, with a good en-US voice (Samantha/Ava
 * when available) and cadence per emotion: the reply is spoken phrase by phrase, each with its
 * own pitch and rate and real pauses between them (see prosody.ts).
 */
export class BrowserTts implements TtsProvider {
  /** Bumped by cancel() and each new speak(), so an older reply stops queueing chunks. */
  private generation = 0;
  private wake: (() => void) | null = null;

  async speak(text: string, emotion: Emotion, options: SpeakOptions = {}): Promise<void> {
    return this.speakWith(text, EMOTION_PROFILES[emotion], options.speed ?? 1);
  }

  /** Speak with an explicit profile (the tone tester uses this to A/B custom settings). */
  async speakWith(text: string, profile: VoiceProfile, speed = 1): Promise<void> {
    if (!('speechSynthesis' in window)) {
      console.warn('[tts] speechSynthesis is not available in this browser');
      return;
    }
    this.cancel(); // never overlap two replies
    const generation = this.generation;
    const voice = await preferredVoice();
    for (const chunk of planSpeech(text, profile, speed)) {
      if (generation !== this.generation) return;
      await this.say(chunk, voice);
      if (generation !== this.generation) return;
      if (chunk.gapAfterMs > 0) await this.pause(chunk.gapAfterMs);
    }
  }

  cancel() {
    this.generation++;
    this.wake?.(); // end a pause right away
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  private say(chunk: SpeechChunk, voice: SpeechSynthesisVoice | null): Promise<void> {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(chunk.text);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.rate = chunk.rate;
      u.pitch = chunk.pitch;
      u.volume = chunk.volume;
      // Some browsers occasionally never fire 'end': don't hang the reply forever.
      const words = chunk.text.split(/\s+/).length;
      const guard = setTimeout(done, 2000 + (words * 700) / chunk.rate);
      function done() {
        clearTimeout(guard);
        resolve();
      }
      // Resolve on both normal end and errors (cancel() triggers an 'interrupted' error).
      u.onend = done;
      u.onerror = done;
      window.speechSynthesis.speak(u);
    });
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      // (the arrow defers the lookup of `finish` until the timer fires)
      const timer = setTimeout(() => finish(), ms);
      const finish = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
      this.wake = finish;
    });
  }
}
