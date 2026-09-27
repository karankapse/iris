import { beforeEach, describe, expect, it } from 'vitest';
import type { FaceFrame, GazePoint, ScreenGaze } from '../../contracts';
import { createEmitter } from '../emitter';
import { IDENTITY, applyAffine, fitAffine } from './affine';
import { FilteredGaze, fusePoint, type GazeCalibration } from './FilteredGaze';
import { fitLandmarkModel, landmarkFeatures, predictLandmark } from './landmarkModel';

const VP = { w: 1000, h: 800 };

/** Deterministic noise. */
function rng(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
}

describe('fitAffine', () => {
  const targets = [
    [100, 200],
    [500, 200],
    [900, 200],
    [100, 700],
    [500, 700],
    [900, 700],
  ];

  it('undoes a squeeze toward the middle (what WebGazer does)', () => {
    const pairs = targets.map(([tx, ty]) => ({
      px: 500 + 0.55 * (tx - 500),
      py: 400 + 0.6 * (ty - 400),
      tx,
      ty,
    }));
    const fix = fitAffine(pairs, VP)!;
    for (const p of pairs) {
      const c = applyAffine(fix, p.px, p.py);
      expect(Math.abs(c.x - p.tx)).toBeLessThan(15);
      expect(Math.abs(c.y - p.ty)).toBeLessThan(15);
    }
  });

  it('stays (nearly) identity when predictions are already right', () => {
    const fix = fitAffine(
      targets.map(([tx, ty]) => ({ px: tx, py: ty, tx, ty })),
      VP,
    )!;
    expect(fix.a).toBeCloseTo(1, 2);
    expect(fix.c).toBeCloseTo(0, -1);
  });

  it('refuses too few points or a wild result', () => {
    expect(
      fitAffine(
        targets.slice(0, 3).map(([tx, ty]) => ({ px: tx, py: ty, tx, ty })),
        VP,
      ),
    ).toBeNull();
    // every prediction in the same spot: would need an infinite stretch
    const flat = targets.map(([tx, ty]) => ({ px: 500 + (tx - 500) * 0.05, py: 400, tx, ty }));
    expect(fitAffine(flat, VP)).toBeNull();
  });
});

const frame = (irisX: number, irisY: number, t = 0): FaceFrame => ({
  t,
  blendshapes: { eyeBlinkLeft: 0, eyeBlinkRight: 0 },
  gaze: { x: irisX * 4, y: irisY * 6 },
  metrics: { irisX, irisY },
  landmarks: [],
  headPose: { yaw: 0, pitch: 0, roll: 0 },
});

describe('landmark gaze model', () => {
  /** Iris offset for a screen point: small (a few % of eye width), like a real eye. */
  const irisFor = (x: number, y: number) => ({
    ix: (x / VP.w - 0.5) * 0.25,
    iy: (y / VP.h - 0.5) * 0.1,
  });

  function samples(noise = 0.004) {
    const r = rng(7);
    const out = [];
    let group = 0;
    for (const y of [200, 450, 700]) {
      for (const x of [70, 280, 500, 720, 930]) {
        const { ix, iy } = irisFor(x, y);
        for (let k = 0; k < 15; k++) {
          const f = landmarkFeatures(frame(ix + noise * r(), iy + noise * r()))!;
          out.push({ f, x, y, group });
        }
        group++;
      }
    }
    return out;
  }

  it('needs iris data', () => {
    const f = frame(0, 0);
    f.metrics = {};
    expect(landmarkFeatures(f)).toBeNull();
  });

  it('learns to map iris position to the screen, accurately left-to-right', () => {
    const model = fitLandmarkModel(samples())!;
    expect(model).not.toBeNull();
    for (const x of [170, 500, 830]) {
      const { ix, iy } = irisFor(x, 670);
      const p = predictLandmark(model, landmarkFeatures(frame(ix, iy))!);
      expect(Math.abs(p.x - x)).toBeLessThan(60);
    }
    expect(model.errX).toBeLessThan(80); // honest (cross-validated) error estimate
  });

  it('refuses with too few dots', () => {
    expect(fitLandmarkModel(samples().filter((s) => s.group < 3))).toBeNull();
  });
});

describe('fusePoint', () => {
  const cal: GazeCalibration = {
    webgazerFix: { ...IDENTITY, c: 10 },
    landmarkFix: IDENTITY,
    weights: { x: 0.25, y: 0.75 },
    landmark: { mean: [], std: [], wx: [], wy: [], errX: 1, errY: 1 },
  };

  it('corrects the tracker, then blends per axis', () => {
    const p = fusePoint(cal, { x: 100, y: 100 }, { x: 200, y: 200 });
    expect(p.x).toBeCloseTo(0.25 * 110 + 0.75 * 200);
    expect(p.y).toBeCloseTo(0.75 * 100 + 0.25 * 200);
  });

  it('uses the tracker alone without a landmark estimate', () => {
    expect(fusePoint(cal, { x: 100, y: 100 }, null)).toEqual({ x: 110, y: 100 });
  });
});

class FakeGaze implements ScreenGaze {
  private emitter = createEmitter<GazePoint | null>();
  async start() {}
  stop() {}
  onGaze(h: (p: GazePoint | null) => void) {
    return this.emitter.on(h);
  }
  train() {}
  async clearTraining() {}
  emit(p: GazePoint | null) {
    this.emitter.emit(p);
  }
}

describe('FilteredGaze calibration state', () => {
  beforeEach(() => localStorage.clear());

  it('collects landmark samples while training and uses them after fitLandmarks()', async () => {
    const inner = new FakeGaze();
    const g = new FilteredGaze(inner);
    g.setParams({ headGainX: 0, headGainY: 0, minCutoff: 1000 }); // no smoothing: see the raw fusion
    await g.start();
    const r = rng(3);
    let group = 0;
    for (const y of [200, 450, 700]) {
      for (const x of [70, 280, 500, 720, 930]) {
        g.markPoint(group++);
        for (let k = 0; k < 10; k++) {
          const t = performance.now();
          g.onFaceFrame(frame((x / VP.w - 0.5) * 0.25 + 0.003 * r(), (y / VP.h - 0.5) * 0.1, t));
          g.train(x, y);
        }
      }
    }
    expect(g.fitLandmarks()).not.toBeNull();
    g.setCorrection({ webgazerFix: IDENTITY, landmarkFix: IDENTITY, weights: { x: 0.1, y: 0.1 } });

    const out: (GazePoint | null)[] = [];
    g.onGaze((p) => out.push(p));
    const t = performance.now();
    g.onFaceFrame(frame((150 / VP.w - 0.5) * 0.25, (700 / VP.h - 0.5) * 0.1, t)); // looking left
    inner.emit({ x: 500, y: 400, t }); // the tracker wrongly says "middle"
    expect(out.at(-1)!.x).toBeLessThan(320); // the landmarks pull it back to the left
  });

  it('clearTraining() forgets the model and corrections', async () => {
    const g = new FilteredGaze(new FakeGaze());
    g.setCorrection({
      webgazerFix: { ...IDENTITY, c: 50 },
      landmarkFix: IDENTITY,
      weights: { x: 0.5, y: 0.5 },
    });
    await g.clearTraining();
    expect(g.calibration().webgazerFix).toEqual(IDENTITY);
    expect(new FilteredGaze(new FakeGaze()).calibration().weights).toEqual({ x: 1, y: 1 });
  });
});

/** A tracker that also hands over per-frame "eye-patch" features (like WebGazerGaze). */
class FeatureGaze extends FakeGaze {
  latest: { f: number[]; t: number } | null = null;
  taught = 0;
  train() {
    this.taught++;
  }
  eyeFeatures() {
    return this.latest;
  }
}

describe('FilteredGaze own eye-patch model', () => {
  beforeEach(() => localStorage.clear());

  /** Features that say where the person looks (linearly), the tracker's own guess is always wrong. */
  function show(inner: FeatureGaze, x: number, y: number, t: number, noise = 0) {
    inner.latest = { f: [x / 1000 + noise, y / 1000 - noise, 0.5 + noise], t };
    inner.emit({ x: 512, y: 384, t });
  }

  async function trained() {
    const inner = new FeatureGaze();
    const g = new FilteredGaze(inner);
    g.setParams({ headGainX: 0, headGainY: 0, minCutoff: 1000 });
    await g.start();
    const r = rng(5);
    let group = 0;
    for (const y of [150, 450, 700])
      for (const x of [100, 350, 650, 900]) {
        g.markPoint(group++);
        for (let k = 0; k < 8; k++) {
          show(inner, x, y, performance.now(), 0.002 * r());
          g.train(x, y);
        }
      }
    return { inner, g };
  }

  it('learns from the tracker features and uses that instead of the tracker guess', async () => {
    const { inner, g } = await trained();
    expect(g.fitModels().tracker).not.toBeNull();
    expect(g.usesPatchModel()).toBe(true);
    const out: (GazePoint | null)[] = [];
    g.onGaze((p) => out.push(p));
    show(inner, 150, 700, performance.now());
    expect(out.at(-1)!.x).toBeLessThan(250);
    expect(out.at(-1)!.y).toBeGreaterThan(600);

    g.setParams({ patchModel: 0 }); // switched off: back to the tracker's own (wrong) guess
    show(inner, 150, 700, performance.now());
    expect(out.at(-1)!.x).toBeGreaterThan(400); // (the smoothing is still gliding over)
  });

  it('keeps working when the tracker says NaN, as long as its features come through', async () => {
    const { inner, g } = await trained();
    g.fitModels();
    const out: (GazePoint | null)[] = [];
    g.onGaze((p) => out.push(p));
    const t = performance.now();
    inner.latest = { f: [0.9, 0.15, 0.5], t };
    inner.emit({ x: NaN, y: NaN, t });
    expect(out.at(-1)!.x).toBeGreaterThan(800);
  });

  it('observe() keeps a sample without teaching the tracker', async () => {
    const { inner, g } = await trained();
    const taught = inner.taught;
    show(inner, 500, 500, performance.now());
    expect(g.observe(500, 500, 'check')).toBe(true);
    expect(inner.taught).toBe(taught);
    expect(g.samples().at(-1)).toMatchObject({ kind: 'check', x: 500, y: 500 });
  });

  it('can leave the check samples out of the fit, predicting them from the final model instead', async () => {
    const { inner, g } = await trained();
    g.markPoint(100);
    for (let k = 0; k < 8; k++) {
      show(inner, 500, 500, performance.now());
      g.observe(500, 500, 'check');
    }
    const without = g.fitModels({ exclude: ['check'] }).tracker!;
    const withCheck = g.fitModels().tracker!;
    expect(without.cv.length).toBe(g.samples().filter((s) => s.kind === 'train').length);
    expect(withCheck.cv.length).toBe(g.samples().length);
  });

  it('saves the model with the calibration, and ignores a corrupt one', async () => {
    const { g } = await trained();
    g.fitModels();
    expect(new FilteredGaze(new FeatureGaze()).calibration().tracker).not.toBeNull();
    const saved = JSON.parse(localStorage.getItem('iris.gazeCalibration.v1')!);
    saved.tracker.wx[0] = null;
    localStorage.setItem('iris.gazeCalibration.v1', JSON.stringify(saved));
    expect(new FilteredGaze(new FeatureGaze()).calibration().tracker).toBeNull();
  });
});
