import type { Emotion } from '../../../contracts';

export interface VoiceProfile {
  /** 0.1..10, 1 = normal speaking speed */
  rate: number;
  /** 0..2, 1 = normal pitch */
  pitch: number;
  /** 0..1 */
  volume: number;
}

/**
 * How each emotion changes the browser's built-in voice. These numbers are a starting point:
 * tweak them by ear! (A cloud TTS with real emotional styles would replace this table.)
 */
export const EMOTION_PROFILES: Record<Emotion, VoiceProfile> = {
  neutral: { rate: 0.98, pitch: 1.0, volume: 1.0 },
  happy: { rate: 1.15, pitch: 1.35, volume: 1.0 },
  sad: { rate: 0.8, pitch: 0.8, volume: 0.75 },
  excited: { rate: 1.25, pitch: 1.35, volume: 1.0 },
  joking: { rate: 1.2, pitch: 1.15, volume: 1.0 },
  serious: { rate: 0.9, pitch: 0.85, volume: 1.0 },
};
