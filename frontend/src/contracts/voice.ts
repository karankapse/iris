// ============================================================================
// Voice output contracts  (Module 4)
// ============================================================================
import type { Emotion } from './emotion';

export interface SpeakOptions {
  /** Speech speed multiplier from the user's settings (1 = the tone's normal speed). */
  speed?: number;
}

export interface TtsProvider {
  /**
   * Speak `text` with the given emotional tone. Resolves when speech has finished.
   * IMPORTANT: only call this after the user has confirmed. The app never speaks on its own.
   */
  speak(text: string, emotion: Emotion, options?: SpeakOptions): Promise<void>;
  /** Stop speaking immediately. */
  cancel(): void;
}
