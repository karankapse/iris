import { describe, expect, it } from 'vitest';
import type { EyeEvent, FaceFrame, FaceTracker } from '../../../contracts';
import { createEmitter } from '../../../core/emitter';
import { DEFAULT_GLANCE, GlanceStepper, glanceFromSamples } from './glance';
import { RealEyeInput } from './RealEyeInput';

const frame = (t: number, gazeX = 0, blink = 0, irisX = 0): FaceFrame => ({
  t,
  blendshapes: { eyeBlinkLeft: blink, eyeBlinkRight: blink },
  gaze: { x: gazeX, y: 0 },
  metrics: { irisX },
  landmarks: [],
  headPose: { yaw: 0, pitch: 0, roll: 0 },
});

describe('GlanceStepper', () => {
  const run = (st: GlanceStepper, x: number, ms: number, t0: number) => {
    const steps: number[] = [];
    for (let t = t0; t < t0 + ms; t += 33) {
      const s = st.update(t, x, false);
      if (s) steps.push(s);
    }
    return steps;
  };

  it('one glance = one step, in the right direction', () => {
    const st = new GlanceStepper();
    expect(run(st, -0.6, 400, 0)).toEqual([-1]);
    run(st, 0, 400, 500);
    expect(run(st, 0.6, 400, 1000)).toEqual([1]);
  });

  it('holding the glance does not keep stepping; returning to the middle re-arms it', () => {
    const st = new GlanceStepper();
    expect(run(st, 0.6, 3000, 0)).toEqual([1]);
    run(st, 0, 300, 3100);
    expect(run(st, 0.6, 300, 3500)).toEqual([1]);
  });

  it('ignores twitches shorter than the hold time and small movements', () => {
    const st = new GlanceStepper();
    expect(run(st, 0.6, 60, 0)).toEqual([]); // 2 frames
    expect(run(st, 0.15, 1000, 200)).toEqual([]); // below threshold
  });

  it('does nothing while suppressed (blinking)', () => {
    const st = new GlanceStepper();
    let n = 0;
    for (let t = 0; t < 500; t += 33) n += Math.abs(st.update(t, 0.9, true));
    expect(n).toBe(0);
  });
});

describe('glance calibration', () => {
  const frames = (x: number, n = 30, irisX = 0) =>
    Array.from({ length: n }, (_, i) => frame(i * 33, x + ((i % 3) - 1) * 0.01, 0, irisX));

  it('learns center, threshold and direction', () => {
    const { tuning, warnings } = glanceFromSamples({
      center: frames(0.05),
      left: frames(-0.35),
      right: frames(0.45),
    });
    expect(tuning.sign).toBe(1);
    expect(tuning.center).toBeCloseTo(0.05, 2);
    expect(tuning.threshold).toBeCloseTo(0.2, 2); // half of the weaker side (0.4)
    expect(warnings).toEqual([]);
  });

  it('detects a mirrored signal (looking right makes it go DOWN)', () => {
    const { tuning } = glanceFromSamples({
      center: frames(0),
      left: frames(0.4),
      right: frames(-0.4),
    });
    expect(tuning.sign).toBe(-1);
    const st = new GlanceStepper(tuning);
    let step = 0;
    for (let t = 0; t < 400; t += 33) step ||= st.update(t, -0.4, false);
    expect(step).toBe(1); // still "right"
  });

  it('picks the iris signal when the blendshape signal barely moves', () => {
    const { tuning } = glanceFromSamples({
      center: frames(0, 30, 0),
      left: frames(0.01, 30, 0.12),
      right: frames(-0.01, 30, -0.12),
    });
    expect(tuning.signal).toBe('iris');
  });

  it('warns when the glances are too small', () => {
    const { warnings } = glanceFromSamples({
      center: frames(0),
      left: frames(-0.01),
      right: frames(0.01),
    });
    expect(warnings.length).toBeGreaterThan(0);
  });
});

class FakeTracker implements FaceTracker {
  video = null;
  private e = createEmitter<FaceFrame>();
  async start() {}
  stop() {}
  onFrame(h: (f: FaceFrame) => void) {
    return this.e.on(h);
  }
  emit(f: FaceFrame) {
    this.e.emit(f);
  }
}

describe('RealEyeInput in glance mode', () => {
  function setup(dwellMs = 7000) {
    localStorage.clear();
    const tracker = new FakeTracker();
    const eye = new RealEyeInput(tracker, null);
    const events: EyeEvent[] = [];
    eye.on((e) => events.push(e));
    eye.start({ mode: 'glance', optionCount: 3 });
    eye.configure({ dwellMs, blinkMs: 500, steadinessMs: 150, doubleBlinkBack: false });
    let t = 1000;
    const play = (ms: number, x = 0, blink = 0) => {
      for (const end = t + ms; t < end; t += 33) tracker.emit(frame(t, x, blink));
    };
    const lit = () =>
      events
        .filter((e): e is Extract<EyeEvent, { type: 'highlight' }> => e.type === 'highlight')
        .at(-1)?.optionIndex;
    const selects = () => events.filter((e) => e.type === 'select');
    return { eye, play, lit, selects };
  }

  it('starts on the middle option', () => {
    expect(setup().lit()).toBe(1);
  });

  it('glance left moves one left, glance right moves one right, and it stops at the ends', () => {
    const h = setup();
    h.play(300);
    h.play(300, -0.6);
    h.play(300);
    expect(h.lit()).toBe(0);
    h.play(300, -0.6);
    h.play(300);
    expect(h.lit()).toBe(0); // already leftmost
    h.play(300, 0.6);
    h.play(300);
    expect(h.lit()).toBe(1);
    h.play(300, 0.6);
    h.play(300);
    expect(h.lit()).toBe(2);
  });

  it('selects after staying on an option for 7 seconds, not before', () => {
    const h = setup();
    h.play(300, 0.6);
    h.play(6500); // 6.5 s after moving
    expect(h.selects()).toEqual([]);
    h.play(800);
    expect(h.selects()).toEqual([{ type: 'select', optionIndex: 2 }]);
  });

  it('moving restarts the 7-second countdown', () => {
    const h = setup();
    h.play(5000);
    h.play(300, -0.6);
    h.play(5000);
    expect(h.selects()).toEqual([]);
  });

  it('a deliberate blink selects right away', () => {
    const h = setup();
    h.play(300);
    h.play(700, 0, 0.9);
    h.play(300);
    expect(h.selects()).toEqual([{ type: 'select', optionIndex: 1 }]);
  });

  it('a new screen starts in the middle again', () => {
    const h = setup();
    h.play(300, 0.6);
    h.play(300);
    expect(h.lit()).toBe(2);
    h.eye.setOptionCount(3);
    expect(h.lit()).toBe(1);
  });

  it('asks for calibration until it has been done', () => {
    expect(setup().eye.status?.().calibrated).toBe(false);
  });

  it('DEFAULT_GLANCE works before calibration', () => {
    expect(DEFAULT_GLANCE.threshold).toBeGreaterThan(0);
  });
});
