// End-to-end: a simulated person goes through the new screen calibration. The fake WebGazer
// squeezes its predictions toward the middle (like the real one), and the fake camera reports an
// iris position that follows where the person looks.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CalibrationStep,
  FaceFrame,
  FaceTracker,
  GazePoint,
  ScreenGaze,
} from '../../../contracts';
import { createEmitter } from '../../../core/emitter';
import { FilteredGaze } from '../../../core/gaze/FilteredGaze';
import { RealEyeInput } from './RealEyeInput';
import { TRAIN_DOTS, positionAdvice } from './screenCalibration';

class FakeTracker implements FaceTracker {
  video = null;
  private emitter = createEmitter<FaceFrame>();
  async start() {}
  stop() {}
  onFrame(h: (f: FaceFrame) => void) {
    return this.emitter.on(h);
  }
  emit(f: FaceFrame) {
    this.emitter.emit(f);
  }
}

class FakeWebGazer implements ScreenGaze {
  private emitter = createEmitter<GazePoint | null>();
  trainedRight = 0;
  async start() {}
  stop() {}
  onGaze(h: (p: GazePoint | null) => void) {
    return this.emitter.on(h);
  }
  train(x: number) {
    if (x > window.innerWidth * 0.6) this.trainedRight++;
  }
  async clearTraining() {
    this.trainedRight = 0;
  }
  emit(p: GazePoint | null) {
    this.emitter.emit(p);
  }
}

function rng(seed = 11) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
}

interface SimOptions {
  /** Report iris metrics (the landmark estimate). */
  landmarks?: boolean;
  /** Tracker predictions for the right side are wrong until it has seen this many right-side samples. */
  rightNeedsSamples?: number;
  /** The tracker reports NaN for its first N points (like WebGazer right after a reset). */
  nanPoints?: number;
  /** The face-landmark signals (iris + MediaPipe eye direction) are pure noise. */
  garbageLandmarks?: boolean;
}

/** A person who looks wherever the calibration dot is, at 30 frames a second. */
function simulate(tracker: FakeTracker, wg: FakeWebGazer, opts: SimOptions = {}) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const r = rng();
  let look = { x: 0.5, y: 0.28 };
  let closed = false;
  let sent = 0;
  const steps: CalibrationStep[] = [];
  const onStep = (s: CalibrationStep) => {
    steps.push(s);
    closed = s.target === 'closed';
    if (s.target === 'point' && s.position) look = { x: s.position.x / 100, y: s.position.y / 100 };
    if (s.target === 'center') look = { x: 0.5, y: 0.28 };
  };
  const timer = setInterval(() => {
    const t = performance.now();
    tracker.emit({
      t,
      blendshapes: { eyeBlinkLeft: closed ? 1 : 0, eyeBlinkRight: closed ? 1 : 0 },
      // MediaPipe's own eye direction: follows the look (or is noise too, in the garbage test)
      gaze: opts.garbageLandmarks
        ? { x: r(), y: r() }
        : { x: (look.x - 0.5) * 1.2 + 0.05 * r(), y: (look.y - 0.5) * 1.2 + 0.05 * r() },
      metrics:
        opts.landmarks === false
          ? {}
          : opts.garbageLandmarks
            ? { irisX: 0.3 * r(), irisY: 0.3 * r() }
            : {
                irisX: (look.x - 0.5) * 0.25 + 0.004 * r(),
                irisY: (look.y - 0.5) * 0.1 + 0.004 * r(),
              },
      landmarks: [],
      headPose: { yaw: 0, pitch: 0, roll: 0 },
    });
    if (closed) return;
    if (sent++ < (opts.nanPoints ?? 0)) {
      wg.emit({ x: NaN, y: NaN, t });
      return;
    }
    const wrongRight = look.x > 0.6 && wg.trainedRight < (opts.rightNeedsSamples ?? 0);
    const lx = wrongRight ? 0.5 : look.x;
    wg.emit({
      x: W * (0.5 + 0.55 * (lx - 0.5)) + 40 * r(),
      y: H * (0.5 + 0.6 * (look.y - 0.5)) + 40 * r(),
      t,
    });
  }, 33);
  return {
    onStep,
    steps,
    stop: () => clearInterval(timer),
    setLook: (x: number, y: number) => (look = { x, y }),
  };
}

function setup(opts: SimOptions = {}) {
  localStorage.clear();
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
  });
  const tracker = new FakeTracker();
  const wg = new FakeWebGazer();
  const gaze = new FilteredGaze(wg);
  tracker.onFrame((f) => gaze.onFaceFrame(f));
  const eye = new RealEyeInput(tracker, gaze);
  eye.start({ mode: 'full', optionCount: 3 });
  void gaze.start();
  const sim = simulate(tracker, wg, opts);
  return { eye, gaze, wg, sim };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('screen calibration', () => {
  it('learns to tell left, middle and right apart, even though the tracker squeezes toward the middle', async () => {
    const { eye, gaze, sim } = setup();
    const done = eye.calibrate(sim.onStep);
    await vi.advanceTimersByTimeAsync(90_000);
    await done;
    const report = eye.lastCalibration()!;
    expect(report.zones.left).toBeGreaterThan(0.9);
    expect(report.zones.middle).toBeGreaterThan(0.9);
    expect(report.zones.right).toBeGreaterThan(0.9);
    expect(report.weights).not.toBeNull(); // both estimates are in use
    expect(gaze.calibration().webgazerFix.a).toBeGreaterThan(1.4); // the squeeze was stretched back out
    expect(eye.status().accuracy).toBeCloseTo(report.overall);
    expect(eye.status().calibrated).toBe(true);
    expect(report.retried).toEqual([]);

    // after calibration, looking at the right column's words lands in the right column
    const out: (GazePoint | null)[] = [];
    gaze.onGaze((p) => out.push(p));
    sim.setLook(0.83, 0.84);
    await vi.advanceTimersByTimeAsync(1500);
    expect(out.at(-1)!.x).toBeGreaterThan((window.innerWidth * 2) / 3);
    sim.stop();
  });

  it('checks the position first, then teaches every zone, one zone at a time', async () => {
    const { eye, sim } = setup();
    const done = eye.calibrate(sim.onStep);
    await vi.advanceTimersByTimeAsync(90_000);
    await done;
    expect(sim.steps[0].target).toBe('center'); // position check first
    const dots = sim.steps
      .filter((s) => s.target === 'point' && s.prompt !== 'Look at the dot (checking accuracy)')
      .map((s) => s.position!);
    expect(dots.slice(0, TRAIN_DOTS.length)).toEqual(TRAIN_DOTS.map(({ x, y }) => ({ x, y })));
    const zonesInOrder = TRAIN_DOTS.map((d) => d.zone).filter((z, i, a) => z !== a[i - 1]);
    expect(zonesInOrder).toEqual(['center', 'right', 'middle', 'left']); // each zone's dots together
    // dots sit just inside both lines between the columns
    for (const line of [100 / 3, 200 / 3]) {
      expect(TRAIN_DOTS.some((d) => d.x < line && line - d.x < 8 && d.y > 50)).toBe(true);
      expect(TRAIN_DOTS.some((d) => d.x > line && d.x - line < 8 && d.y > 50)).toBe(true);
    }
    sim.stop();
  });

  it('re-trains a weak column once and checks again', async () => {
    // WebGazer only (no landmarks), and it gets the right side wrong until it has more samples
    const { eye, wg, sim } = setup({ landmarks: false, rightNeedsSamples: 110 });
    const done = eye.calibrate(sim.onStep);
    await vi.advanceTimersByTimeAsync(150_000);
    await done;
    const report = eye.lastCalibration()!;
    expect(report.retried).toContain('right');
    expect(report.zones.right).toBeGreaterThan(0.9);
    expect(report.weights).toBeNull(); // landmark estimate unavailable: WebGazer only
    expect(wg.trainedRight).toBeGreaterThan(110);
    sim.stop();
  });
});

describe('after a page reload', () => {
  it('says "not calibrated": WebGazer does not keep its training across reloads', () => {
    localStorage.clear();
    localStorage.setItem('iris.gazeCalibrated', '1'); // written by older versions
    const eye = new RealEyeInput(new FakeTracker(), new FilteredGaze(new FakeWebGazer()));
    eye.start({ mode: 'full', optionCount: 3 });
    expect(eye.status().calibrated).toBe(false);
  });
});

describe('positionAdvice', () => {
  const now = 1000;
  const face = (o: Partial<FaceFrame> = {}): FaceFrame => ({
    t: now,
    blendshapes: {},
    gaze: { x: 0, y: 0 },
    metrics: {},
    landmarks: [],
    headPose: { yaw: 0, pitch: 0, roll: 0 },
    ...o,
  });
  const eyes = (left: number, right: number, y = 0.45) => {
    const L = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    L[33] = { x: left, y };
    L[263] = { x: right, y };
    return L;
  };

  it('asks for a face, then distance, centring and a level head', () => {
    expect(positionAdvice(null, now)).toMatch(/can't see your face/);
    expect(positionAdvice(face({ landmarks: eyes(0.47, 0.53) }), now)).toMatch(/closer/);
    expect(positionAdvice(face({ landmarks: eyes(0.3, 0.7) }), now)).toMatch(/back/);
    expect(positionAdvice(face({ landmarks: eyes(0.15, 0.3) }), now)).toMatch(/your left/);
    expect(
      positionAdvice(
        face({ landmarks: eyes(0.44, 0.56), headPose: { yaw: 0, pitch: 0, roll: 20 } }),
        now,
      ),
    ).toMatch(/level/);
    expect(positionAdvice(face({ landmarks: eyes(0.44, 0.56) }), now)).toBeNull();
  });
});

describe('calibration robustness', () => {
  it('survives the tracker reporting NaN at first: the dot keeps following afterwards', async () => {
    const { eye, gaze, sim } = setup({ nanPoints: 60 });
    const done = eye.calibrate(sim.onStep);
    await vi.advanceTimersByTimeAsync(90_000);
    await done;
    const out: (GazePoint | null)[] = [];
    gaze.onGaze((p) => out.push(p));
    sim.setLook(0.17, 0.84);
    await vi.advanceTimersByTimeAsync(1500);
    const last = out.at(-1)!;
    expect(Number.isFinite(last.x)).toBe(true);
    expect(last.x).toBeLessThan(window.innerWidth / 3); // following: in the left column
    sim.stop();
  });

  it('ignores a face-landmark estimate that is pure noise', async () => {
    const { eye, sim } = setup({ garbageLandmarks: true });
    const done = eye.calibrate(sim.onStep);
    await vi.advanceTimersByTimeAsync(90_000);
    await done;
    const report = eye.lastCalibration()!;
    // either the landmark model was rejected, or it gets (almost) no say
    expect(report.weights === null || report.weights.x > 0.9).toBe(true);
    expect(report.zones.left).toBeGreaterThan(0.9);
    expect(report.zones.right).toBeGreaterThan(0.9);
    sim.stop();
  });

  it('never ends worse than the plain tracker on the check dots', async () => {
    const { eye, sim } = setup();
    const done = eye.calibrate(sim.onStep);
    await vi.advanceTimersByTimeAsync(90_000);
    await done;
    const report = eye.lastCalibration()!;
    expect(report.finalErrorPx).toBeLessThanOrEqual(report.rawErrorPx);
    expect(report.correctionUsed).toBe(true); // the squeeze is real here, so it helps
    sim.stop();
  });
});
