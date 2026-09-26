import type { Emotion, SpeakOptions, TtsProvider } from '../../../contracts';

/** Makes no sound; just remembers what it "said". Used in tests and quiet development. */
export class SilentTts implements TtsProvider {
  spoken: { text: string; emotion: Emotion; speed?: number }[] = [];

  async speak(text: string, emotion: Emotion, options: SpeakOptions = {}) {
    this.spoken.push({ text, emotion, speed: options.speed });
  }

  cancel() {}
}
