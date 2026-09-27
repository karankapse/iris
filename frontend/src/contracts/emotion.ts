// ============================================================================
// Emotion contracts  (Module 2: Emotion Detection & Learning)
// ============================================================================
import type { FaceFrame } from './face';

/** Keep in sync with `Emotion` in backend/app/schemas/common.py (CI checks this). */
export const EMOTIONS = ['neutral', 'happy', 'sad', 'excited', 'joking', 'serious'] as const;
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
  /** Several good frames from the reaction window (preferred over the single snapshot). */
  featureFrames?: number[][] | null;
}

/** How well the personal emotion model did on recordings it did not train on. */
export interface TrainingReport {
  /** Average per-emotion accuracy (0..1); null until each emotion was recorded twice. */
  accuracy: number | null;
  perEmotion: Partial<Record<Emotion, number>>;
  /** e.g. "sad needs more examples (record it at least once more)" */
  advice: string[];
}

export interface EmotionDetector {
  /** Feed every camera frame in here (the orchestrator wires FaceTracker -> this). */
  onFrame(frame: FaceFrame): void;
  /** Latest smoothed guess. Must always return something (neutral, 0 if unknown). */
  current(): EmotionEstimate;
  /** The numeric feature vector of the latest frame (or null). Saved with feedback. */
  currentFeatures(): number[] | null;
  /** Optional: like currentFeatures, but null for a bad frame (blinking, head turned away). */
  currentUsableFeatures?(): number[] | null;

  // --- calibration: caregiver/user records examples of each emotion ---
  /** Store the frames captured while the user was showing `label` (returns how many were kept). */
  recordSample(label: Emotion, frames: FaceFrame[]): Promise<number | void>;
  /** Send samples to the backend, fetch the trained model, start using it. */
  train(): Promise<TrainingReport | void>;

  // --- learning: called after each spoken reply ---
  addFeedback(feedback: ToneFeedback): Promise<void>;

  /** Info about the currently loaded personalized model (if trained). */
  readonly modelStats?: { nSamples: number; accuracy: number | null } | null;
}
