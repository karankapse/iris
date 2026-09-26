import { describe, expect, it } from 'vitest';
import {
  CornerTracker,
  FeatureSmoother,
  classify,
  defaultCornerModel,
  gazeFeatures,
  trainCornerModel,
  ZONES,
  type CornerModel,
  type Zone,
} from './corners';
import type { FaceFrame } from '../../../contracts';

/** A tiny seeded random generator so the "noisy user" is the same on every run. */
function rng(seed: number) {
  let s = seed;
  const uniform = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  // Box-Muller: normally distributed noise
  return () => Math.sqrt(-2 * Math.log(uniform() + 1e-12)) * Math.cos(2 * Math.PI * uniform());
}

/** What each zone looks like for a simulated person: [gazeX, gazeY, irisX, irisY, yaw, pitch]. */
const PERSON: Record<Zone, number[]> = {
  center: [0.0, 0.05, 0.0, 0.0, 0, 0],
  'up-left': [-0.25, -0.12, 0.12, -0.06, -6, 4],
  'up-right': [0.25, -0.12, -0.12, -0.06, 6, 4],
  'down-left': [-0.25, 0.3, 0.12, 0.09, -6, -4],
  'down-right': [0.25, 0.3, -0.12, 0.09, 6, -4],
};
/** Frame-to-frame noise: big for MediaPipe's gaze (like real webcams), smaller for the iris. */
const NOISE = [0.12, 0.12, 0.03, 0.03, 2.5, 2.5];

function frames(zone: Zone, n: number, random: () => number): number[][] {
  return Array.from({ length: n }, () => PERSON[zone].map((v, j) => v + random() * NOISE[j]));
}

function trainOnPerson(seed = 1, perZone = 60) {
  const random = rng(seed);
  const samples = {} as Record<Zone, number[][]>;
  for (const z of ZONES) samples[z] = frames(z, perZone, random);
  return trainCornerModel(samples)!;
}

describe('trainCornerModel', () => {
  it('needs enough frames in every zone', () => {
    const samples = {} as Record<Zone, number[][]>;
    for (const z of ZONES) samples[z] = frames(z, 3, rng(1));
    expect(trainCornerModel(samples)).toBeNull();
  });

  it('classifies a noisy simulated person almost perfectly, from single frames', () => {
    const { model } = trainOnPerson();
    const random = rng(99);
    let right = 0;
    let total = 0;
    for (const z of ZONES) {
      for (const f of frames(z, 200, random)) {
        total++;
        if (classify(model, f).zone === z) right++;
      }
    }
    expect(right / total).toBeGreaterThan(0.95);
  });

  it('beats using only MediaPipe gaze (the old approach) on the same noisy person', () => {
    const { model } = trainOnPerson();
    const gazeOnly: CornerModel = { ...model, weight: [1, 1, 0, 0, 0, 0] };
    const random = rng(7);
    const score = (m: CornerModel) => {
      let right = 0;
      let total = 0;
      for (const z of ZONES) {
        for (const f of frames(z, 300, random)) {
          total++;
          if (classify(m, f).zone === z) right++;
        }
      }
      return right / total;
    };
    const fused = score(model);
    const single = score(gazeOnly);
    expect(fused).toBeGreaterThan(single + 0.1); // combining signals is clearly better
  });

  it('gives (almost) no weight to a signal that carries no information', () => {
    const random = rng(3);
    const samples = {} as Record<Zone, number[][]>;
    for (const z of ZONES) {
      // roll (feature 5) is pure noise here: identical distribution in every zone
      samples[z] = frames(z, 60, random).map((f) => [...f.slice(0, 5), random() * 2.5]);
    }
    const { model } = trainCornerModel(samples)!;
    expect(model.weight[5]).toBeLessThan(0.2);
    expect(model.weight[0]).toBeGreaterThan(0.5);
  });

  it('warns when two zones look the same', () => {
    const random = rng(5);
    const samples = {} as Record<Zone, number[][]>;
    for (const z of ZONES) samples[z] = frames(z, 60, random);
    samples['up-right'] = frames('up-left', 60, random); // the person did not really look top-right
    const { warnings } = trainCornerModel(samples)!;
    expect(warnings.join(' ')).toMatch(/top-left and top-right/i);
  });

  it('is not fooled by a few wild frames during calibration (uses medians)', () => {
    const random = rng(11);
    const samples = {} as Record<Zone, number[][]>;
    for (const z of ZONES) samples[z] = frames(z, 60, random);
    samples.center.push([5, 5, 5, 5, 90, 90], [-5, 5, 5, -5, -90, 90]); // glitches
    const { model } = trainCornerModel(samples)!;
    expect(model.centroids.center[0]).toBeCloseTo(0, 1);
  });
});

describe('defaultCornerModel (no calibration yet)', () => {
  it('sorts obvious looks by MediaPipe gaze alone', () => {
    const m = defaultCornerModel();
    const at = (x: number, y: number) => classify(m, [x, y, 0, 0, 0, 0]).zone;
    expect(at(0, 0)).toBe('center');
    expect(at(-0.5, -0.3)).toBe('up-left');
    expect(at(0.5, -0.3)).toBe('up-right');
    expect(at(-0.5, 0.5)).toBe('down-left');
    expect(at(0.5, 0.5)).toBe('down-right');
  });
});

describe('FeatureSmoother', () => {
  it('removes a one-frame spike and reduces noise', () => {
    const s = new FeatureSmoother();
    for (let i = 0; i < 10; i++) s.push([1]);
    const afterGlitch = s.push([50]); // a one-frame spike
    expect(afterGlitch[0]).toBeLessThan(2); // the median ignores it
  });

  it('follows a real change within a handful of frames', () => {
    const s = new FeatureSmoother();
    for (let i = 0; i < 10; i++) s.push([0]);
    let last = [0];
    for (let i = 0; i < 12; i++) last = s.push([1]);
    expect(last[0]).toBeGreaterThan(0.85);
  });
});

describe('CornerTracker', () => {
  const HOLD = 150;
  const feed = (tr: CornerTracker, zone: Zone, ms: number, t0: number, random: () => number) => {
    for (let t = t0; t < t0 + ms; t += 33) {
      tr.update(
        t,
        PERSON[zone].map((v, j) => v + random() * NOISE[j] * 0.5),
        false,
      );
    }
    return tr.current;
  };

  it('settles on the zone being looked at and moves when the gaze moves', () => {
    const { model } = trainOnPerson();
    const tr = new CornerTracker(model, HOLD);
    const random = rng(21);
    expect(feed(tr, 'up-left', 600, 0, random)).toBe('up-left');
    expect(feed(tr, 'down-right', 600, 1000, random)).toBe('down-right');
    expect(feed(tr, 'center', 600, 2000, random)).toBe('center');
  });

  it('ignores a glance shorter than the hold time', () => {
    const { model } = trainOnPerson();
    const tr = new CornerTracker(model, HOLD);
    const random = rng(2);
    feed(tr, 'center', 600, 0, random);
    feed(tr, 'up-right', 66, 700, random); // two frames
    expect(tr.current).toBe('center');
  });

  it('keeps the last zone while suppressed (eyes closing), whatever the numbers say', () => {
    const { model } = trainOnPerson();
    const tr = new CornerTracker(model, HOLD);
    const random = rng(4);
    feed(tr, 'down-left', 600, 0, random);
    for (let t = 700; t < 1100; t += 33) tr.update(t, PERSON['up-right'], true);
    expect(tr.current).toBe('down-left');
  });
});

describe('gazeFeatures', () => {
  it('reads the six signals from a frame, defaulting missing metrics to 0', () => {
    const f: FaceFrame = {
      t: 0,
      blendshapes: {},
      gaze: { x: 0.1, y: -0.2 },
      metrics: { irisX: 0.05 },
      landmarks: [],
      headPose: { yaw: 3, pitch: -4, roll: 0 },
    };
    expect(gazeFeatures(f)).toEqual([0.1, -0.2, 0.05, 0, 3, -4]);
  });
});
