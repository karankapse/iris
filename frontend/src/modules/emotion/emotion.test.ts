import { describe, expect, it } from 'vitest';
import type { FaceFrame } from '../../contracts';
import type { ApiEmotionModel } from '../../core/api';
import { extractFeatures, FEATURE_NAMES, subsample } from './features';
import { bestGuess, predictProbabilities } from './real/predict';

const frame = (blendshapes: Record<string, number>): FaceFrame => ({
  t: 0,
  blendshapes,
  gaze: { x: 0, y: 0 },
  headPose: { yaw: 0, pitch: 0, roll: 0 },
});

describe('extractFeatures', () => {
  it('returns one value per feature name, in order, defaulting to 0', () => {
    const f = extractFeatures(frame({ mouthSmileLeft: 0.7, jawOpen: 0.2 }));
    expect(f).toHaveLength(FEATURE_NAMES.length);
    expect(f[FEATURE_NAMES.indexOf('mouthSmileLeft')]).toBe(0.7);
    expect(f[FEATURE_NAMES.indexOf('jawOpen')]).toBe(0.2);
    expect(f[FEATURE_NAMES.indexOf('browInnerUp')]).toBe(0);
  });

  it('ignores blink blendshapes (blinks are the control signal)', () => {
    expect(FEATURE_NAMES.some((n) => n.startsWith('eyeBlink'))).toBe(false);
  });
});

describe('subsample', () => {
  it('keeps short lists and spreads long ones evenly', () => {
    expect(subsample([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(subsample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5)).toEqual([0, 2, 4, 6, 8]);
  });
});

// A hand-made 2-class model: "happy" when smile is high, "serious" when brow is high.
const model: ApiEmotionModel = {
  user_id: 't',
  feature_names: ['smile', 'brow'],
  classes: ['happy', 'serious'],
  means: [0.5, 0.5],
  scales: [0.5, 0.5],
  coef: [
    [2, -2],
    [-2, 2],
  ],
  intercept: [0, 0],
  n_samples: 10,
};

describe('predictProbabilities', () => {
  it('returns probabilities that sum to 1 and pick the right class', () => {
    const probs = predictProbabilities(model, { smile: 1, brow: 0 });
    expect(probs.happy + probs.serious).toBeCloseTo(1);
    expect(bestGuess(probs).emotion).toBe('happy');
    expect(bestGuess(predictProbabilities(model, { smile: 0, brow: 1 })).emotion).toBe('serious');
  });

  it('treats missing features as 0 instead of crashing', () => {
    expect(() => predictProbabilities(model, {})).not.toThrow();
  });
});
