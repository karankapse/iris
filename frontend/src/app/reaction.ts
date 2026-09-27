import type { Emotion, EmotionEstimate, FaceReaction } from '../contracts';

/** Face readings below this are not trusted as a reaction. */
const MIN_CONFIDENCE = 0.5;
/** A non-neutral expression must last at least this share of the reaction window: one stray
 * reading (the model is wrong on ~2% of neutral frames) must not become the reaction. */
export const MIN_SHARE = 1 / 3;

/**
 * Sum up the face readings taken while the user reacted to what was just said:
 *   emotion: the expression that LASTED (the most frequent non-neutral one, if it held for at
 *            least MIN_SHARE of the readings), else null (= neutral), and
 *   face:    the full picture: each emotion's confidence-weighted share of the window.
 */
export function summarizeReaction(samples: EmotionEstimate[]): {
  emotion: Emotion | null;
  face: FaceReaction;
} {
  const weights: Partial<Record<Emotion, number>> = {};
  const counts: Partial<Record<Emotion, number>> = {};
  for (const s of samples) {
    if (s.confidence < MIN_CONFIDENCE) continue;
    weights[s.emotion] = (weights[s.emotion] ?? 0) + s.confidence;
    counts[s.emotion] = (counts[s.emotion] ?? 0) + 1;
  }
  const n = Math.max(1, samples.length);
  let peak: Emotion | null = null;
  for (const [e, c] of Object.entries(counts) as [Emotion, number][]) {
    if (e === 'neutral' || c / n < MIN_SHARE) continue;
    if (!peak || c > (counts[peak] ?? 0)) peak = e;
  }
  const scores: Partial<Record<Emotion, number>> = {};
  for (const [e, w] of Object.entries(weights) as [Emotion, number][]) {
    scores[e] = Math.round((w / n) * 100) / 100;
  }
  // how sure: the average confidence of the readings that showed it
  const confidence = peak ? (weights[peak] ?? 0) / (counts[peak] ?? 1) : 0;
  return {
    emotion: peak,
    face: { scores, peak, confidence: Math.round(confidence * 100) / 100 },
  };
}
