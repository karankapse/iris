import { describe, expect, it, vi } from 'vitest';
import { api } from '../../core/api';
import { RETRAIN_AFTER, RealEmotionDetector } from './real/RealEmotionDetector';
import type { FaceFrame } from '../../contracts';
import type { ApiEmotionModel } from '../../core/api';
import { extractFeatures, FEATURE_NAMES, subsample, usableFrame } from './features';
import { bestGuess, predictProbabilities } from './real/predict';

const frame = (
  blendshapes: Record<string, number>,
  metrics: Record<string, number> = {},
): FaceFrame => ({
  t: 0,
  blendshapes,
  metrics,
  landmarks: [],
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

  it('includes landmark-based metrics such as mouth asymmetry', () => {
    const f = extractFeatures(frame({}, { mouthAsymmetry: 0.04 }));
    expect(f[FEATURE_NAMES.indexOf('mouthAsymmetry')]).toBe(0.04);
  });

  it('ignores blink blendshapes (blinks are the control signal)', () => {
    expect(FEATURE_NAMES.some((n) => n.startsWith('eyeBlink'))).toBe(false);
  });
});

describe('usableFrame', () => {
  it('drops frames that would teach the wrong thing', () => {
    expect(usableFrame(frame({ mouthSmileLeft: 0.5 }))).toBe(true);
    expect(usableFrame(frame({}))).toBe(false); // no face
    expect(usableFrame(frame({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.8 }))).toBe(false);
    expect(
      usableFrame({ ...frame({ jawOpen: 0.1 }), headPose: { yaw: 40, pitch: 0, roll: 0 } }),
    ).toBe(false);
    expect(
      usableFrame({ ...frame({ jawOpen: 0.1 }), headPose: { yaw: 0, pitch: -30, roll: 0 } }),
    ).toBe(false);
  });

  it('recordSample keeps only good frames, up to 90, and rejects a bad recording', async () => {
    const spy = vi.spyOn(api, 'addSamples').mockResolvedValue({ stored: 0 });
    vi.spyOn(api, 'getModel').mockResolvedValue(null);
    const d = new RealEmotionDetector();
    const good = Array.from({ length: 150 }, () => frame({ mouthSmileLeft: 0.6 }));
    const blinks = Array.from({ length: 30 }, () => frame({ eyeBlinkLeft: 1, eyeBlinkRight: 1 }));
    expect(await d.recordSample('happy', [...good, ...blinks])).toBe(90);
    expect(spy.mock.calls[0][0].samples).toHaveLength(90);
    await expect(d.recordSample('happy', blinks)).rejects.toThrow('Not enough clear frames');
    vi.restoreAllMocks();
  });

  it('sends the reaction-window frames with a confirmed tone', async () => {
    const spy = vi
      .spyOn(api, 'feedback')
      .mockResolvedValue({ stored: true, added_training_sample: true });
    vi.spyOn(api, 'getModel').mockResolvedValue(null);
    const d = new RealEmotionDetector();
    const frames = Array.from({ length: 10 }, (_, i) => FEATURE_NAMES.map(() => i / 10));
    await d.addFeedback({
      utteranceId: 'u',
      replyText: 'Hi',
      spokenTone: 'happy',
      userToneOk: true,
      featureFrames: frames,
    });
    expect(spy.mock.calls[0][0]).toMatchObject({
      feature_frames: frames,
      feature_names: [...FEATURE_NAMES],
    });
    vi.restoreAllMocks();
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
  coefs: [
    [
      [2, -2],
      [-2, 2],
    ],
  ],
  intercepts: [[0, 0]],
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

describe('automatic retraining from feedback', () => {
  const feedback = (n: number) => ({
    utteranceId: `u${n}`,
    replyText: 'hi',
    spokenTone: 'happy' as const,
    userToneOk: true,
    features: [0.5],
  });

  it(`retrains after ${RETRAIN_AFTER} confirmed examples, not before`, async () => {
    vi.spyOn(api, 'getModel').mockResolvedValue(null);
    vi.spyOn(api, 'feedback').mockResolvedValue({ stored: true, added_training_sample: true });
    const train = vi.spyOn(api, 'train').mockResolvedValue(model);
    const detector = new RealEmotionDetector();

    for (let i = 1; i < RETRAIN_AFTER; i++) await detector.addFeedback(feedback(i));
    expect(train).not.toHaveBeenCalled();
    await detector.addFeedback(feedback(RETRAIN_AFTER));
    expect(train).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('feedback that did not become a training example does not count toward retraining', async () => {
    vi.spyOn(api, 'getModel').mockResolvedValue(null);
    vi.spyOn(api, 'feedback').mockResolvedValue({ stored: true, added_training_sample: false });
    const train = vi.spyOn(api, 'train').mockResolvedValue(model);
    const detector = new RealEmotionDetector();
    for (let i = 0; i < RETRAIN_AFTER * 2; i++) await detector.addFeedback(feedback(i));
    expect(train).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('a failed retrain (e.g. only one emotion so far) does not break the app', async () => {
    vi.spyOn(api, 'getModel').mockResolvedValue(null);
    vi.spyOn(api, 'feedback').mockResolvedValue({ stored: true, added_training_sample: true });
    vi.spyOn(api, 'train').mockRejectedValue(
      new Error('Need examples of at least 2 different emotions'),
    );
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const detector = new RealEmotionDetector();
    for (let i = 0; i < RETRAIN_AFTER; i++) await detector.addFeedback(feedback(i));
    expect(info).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
