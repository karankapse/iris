import { beforeEach, describe, expect, it } from 'vitest';
import type { FaceFrame, GazePoint, ScreenGaze } from '../../contracts';
import { createEmitter } from '../emitter';
import { FilteredGaze, type GazeSample } from './FilteredGaze';
import { OneEuroFilter } from './oneEuro';

const PARAMS = { minCutoff: 0.5, beta: 0.01, dCutoff: 1 };

describe('OneEuroFilter', () => {
  it('passes the first value through', () => {
    expect(new OneEuroFilter(PARAMS).filter(100, 0)).toBe(100);
  });

  it('removes most jitter when the input is still', () => {
    const f = new OneEuroFilter(PARAMS);
    const out: number[] = [];
    for (let i = 0; i < 90; i++) out.push(f.filter(500 + (i % 2 ? 30 : -30), i * 33)); // ±30 px jitter
    const tail = out.slice(-30);
    const spread = Math.max(...tail) - Math.min(...tail);
    expect(spread).toBeLessThan(10); // was 60
  });

  it('follows a fast jump with little lag (unlike heavy constant smoothing)', () => {
    const f = new OneEuroFilter(PARAMS);
    for (let i = 0; i < 30; i++) f.filter(0, i * 33);
    let v = 0;
    for (let i = 30; i < 36; i++) v = f.filter(800, i * 33); // ~200 ms after a saccade
    expect(v).toBeGreaterThan(600);
  });

  it('an invalid value never poisons the filter', () => {
    const f = new OneEuroFilter(PARAMS);
    f.filter(100, 0);
    expect(Number.isNaN(f.filter(NaN, 33))).toBe(true);
    expect(f.filter(110, 66)).toBeGreaterThan(99); // still working
  });

  it('reset forgets the previous position', () => {
    const f = new OneEuroFilter(PARAMS);
    f.filter(0, 0);
    f.reset();
    expect(f.filter(900, 33)).toBe(900);
  });
});

class FakeGaze implements ScreenGaze {
  private emitter = createEmitter<GazePoint | null>();
  trained: [number, number][] = [];
  async start() {}
  stop() {}
  onGaze(h: (p: GazePoint | null) => void) {
    return this.emitter.on(h);
  }
  train(x: number, y: number) {
    this.trained.push([x, y]);
  }
  async clearTraining() {}
  emit(p: GazePoint | null) {
    this.emitter.emit(p);
  }
}

const head = (t: number, yaw: number, pitch: number): FaceFrame => ({
  t,
  blendshapes: {},
  gaze: { x: 0, y: 0 },
  metrics: {},
  landmarks: [],
  headPose: { yaw, pitch, roll: 0 },
});

describe('FilteredGaze', () => {
  beforeEach(() => localStorage.clear());

  async function setup() {
    const inner = new FakeGaze();
    const g = new FilteredGaze(inner);
    await g.start();
    const out: (GazePoint | null)[] = [];
    const samples: GazeSample[] = [];
    g.onGaze((p) => out.push(p));
    g.onSample((s) => samples.push(s));
    return { inner, g, out, samples };
  }

  it('is still a ScreenGaze: training goes to the real tracker', async () => {
    const { inner, g } = await setup();
    g.train(10, 20);
    expect(inner.trained).toEqual([[10, 20]]);
  });

  it('passes "no face" through and reports raw vs filtered samples', async () => {
    const { inner, out, samples } = await setup();
    const now = performance.now();
    inner.emit({ x: 100, y: 200, t: now });
    inner.emit(null);
    expect(out[0]).toMatchObject({ x: 100, y: 200 });
    expect(out[1]).toBeNull();
    expect(samples[0].raw).toMatchObject({ x: 100, y: 200 });
  });

  it('compensates head movement relative to the calibration pose', async () => {
    const { inner, g, samples } = await setup();
    g.setParams({ headGainX: 20, headGainY: 10 });
    const t0 = performance.now();
    g.onFaceFrame(head(t0, 2, 5)); // pose during calibration
    g.train(500, 300);
    g.onFaceFrame(head(t0 + 10, 5, 3)); // later: head turned +3° yaw, pitch -2°
    inner.emit({ x: 500, y: 300, t: t0 + 20 });
    const s = samples.at(-1)!;
    expect(s.headDelta).toEqual({ yaw: 3, pitch: -2 });
    expect(s.compensated).toEqual({ x: 500 - 20 * 3, y: 300 + 10 * -2 });
  });

  it('skips compensation without a calibration pose or with a stale head pose', async () => {
    const { inner, g, samples } = await setup();
    const t0 = performance.now();
    g.onFaceFrame(head(t0, 10, 10));
    inner.emit({ x: 500, y: 300, t: t0 + 10 }); // never trained: no baseline
    expect(samples.at(-1)!.compensated).toEqual({ x: 500, y: 300 });
    g.train(1, 1);
    inner.emit({ x: 500, y: 300, t: t0 + 2000 }); // head pose is 2 s old
    expect(samples.at(-1)!.headDelta).toBeNull();
  });

  it('treats NaN points as "no reading" and carries on', async () => {
    const { inner, out } = await setup();
    const t = performance.now();
    inner.emit({ x: NaN, y: NaN, t });
    inner.emit({ x: 300, y: 200, t: t + 33 });
    expect(out[0]).toBeNull();
    expect(out[1]).toMatchObject({ x: 300, y: 200 });
  });

  it('skips tracker points while the eyes are closed (it reads the eyelid, not the gaze)', async () => {
    const { inner, g, out } = await setup();
    const t = performance.now();
    const face = (closed: boolean, at: number): FaceFrame => ({
      ...head(at, 0, 0),
      blendshapes: { eyeBlinkLeft: closed ? 0.9 : 0, eyeBlinkRight: closed ? 0.9 : 0 },
    });
    g.onFaceFrame(face(false, t));
    inner.emit({ x: 300, y: 200, t });
    g.onFaceFrame(face(true, t + 33));
    inner.emit({ x: 300, y: 900, t: t + 33 }); // eyes closed: a wild reading
    g.onFaceFrame(face(false, t + 66));
    inner.emit({ x: 300, y: 900, t: t + 66 }); // just re-opened: still settling
    expect(out).toHaveLength(1);
    g.onFaceFrame(face(false, t + 200));
    inner.emit({ x: 310, y: 205, t: t + 200 });
    expect(out).toHaveLength(2);
    g.setParams({ skipBlinks: 0 });
    g.onFaceFrame(face(true, t + 233));
    inner.emit({ x: 300, y: 900, t: t + 233 });
    expect(out).toHaveLength(3);
  });

  it('saves its parameters', async () => {
    const { g } = await setup();
    g.setParams({ beta: 0.02 });
    expect(new FilteredGaze(new FakeGaze()).getParams().beta).toBe(0.02);
  });
});
