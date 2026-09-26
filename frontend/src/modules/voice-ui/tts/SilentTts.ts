import type { Emotion, TtsProvider } from '../../../contracts';

/** Makes no sound; just remembers what it "said". Used in tests and quiet development. */
export class SilentTts implements TtsProvider {
  spoken: { text: string; emotion: Emotion }[] = [];

  async speak(text: string, emotion: Emotion) {
    this.spoken.push({ text, emotion });
  }

  cancel() {}
}
