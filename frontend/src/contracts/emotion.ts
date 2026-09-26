// ============================================================================
// Emotion contracts  (Module 2: Emotion Detection & Learning)
// ============================================================================
import type { FaceFrame } from './face';

/** Keep in sync with `Emotion` in backend/app/schemas/common.py (CI checks this). */
export const EMOTIONS = ['neutral', 'happy', 'sad', 'joking', 'serious'] as const;
export type Emotion = (typeof EMOTIONS)[number];

export interface EmotionEstimate {
  emotion: Emotion;
  /** 0..1. Below ~0.5 the UI should not trust the guess and should fall back to the mood. */
  confidence: number;
}

/**
 * Feedback about ONE spoken reply. The user's eye yes/no and the partner's tap arrive at
 * different times, so each is optional; send whichever you have (same `utteranceId`).
 */
export interface ToneFeedback {
  utteranceId: string;
  replyText: string;
  spokenTone: Emotion;
  userToneOk?: boolean;
  partnerReaction?: 'understood' | 'seemed_off';
  /** Face-feature snapshot from when the tone was suggested (`currentFeatures()` at that time). */
  features?: number[] | null;
}

export interface EmotionDetector {
  /** Feed every camera frame in here (the orchestrator wires FaceTracker -> this). */
  onFrame(frame: FaceFrame): void;
  /** Latest smoothed guess. Must always return something (neutral, 0 if unknown). */
  current(): EmotionEstimate;
  /** The numeric feature vector of the latest frame (or null). Saved with feedback. */
  currentFeatures(): number[] | null;

  // --- calibration: caregiver/user records examples of each emotion ---
  /** Store the frames captured while the user was showing `label`. */
  recordSample(label: Emotion, frames: FaceFrame[]): Promise<void>;
  /** Send samples to the backend, fetch the trained model, start using it. */
  train(): Promise<void>;

  // --- learning: called after each spoken reply ---
  addFeedback(feedback: ToneFeedback): Promise<void>;
}
