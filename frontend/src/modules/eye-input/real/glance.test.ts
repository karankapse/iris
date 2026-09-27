import { describe, expect, it } from 'vitest';
import type { EyeEvent, FaceFrame, FaceTracker } from '../../../contracts';
import { createEmitter } from '../../../core/emitter';
import { DEFAULT_GLANCE, EyeGestures, type GestureEvent, glanceFromSamples } from './glance';
import { RealEyeInput } from './RealEyeInput';

const frame = (t: number, gazeX = 0, blink = 0, irisX = 0): FaceFrame => ({
  t,
  blendshapes: { eyeBlinkLeft: blink, eyeBlinkRight: blink },
  gaze: { x: gazeX, y: 0 },
  metrics: { irisX },
  landmarks: [],
  headPose: { yaw: 0, pitch: 0, roll: 0 },
});

describe('EyeGestures', () => {
  const run = (g: EyeGestures, x: number, ms: number, t0: number) => {
    const events: GestureEvent[] = [];
    for (let t = t0; t < t0 + ms; t += 33) {
      const e = g.update(t, x, false);
      if (e) events.push(e);
    }
    return events;
  };

  it('a quick look out and back is a flick in that direction', () => {
    const g = new EyeGestures();
    run(g, 0, 300, 0);
    expect(run(g, -0.6, 300, 300)).toEqual([]); // nothing until the eyes come back
    expect(run(g, 0, 300, 600)).toEqual([{ type: 'flick', dir: 'left' }]);
    run(g, 0.6, 300, 900);
    expect(run(g, 0, 300, 1200)).toEqual([{ type: 'flick', dir: 'right' }]);
  });

  it('staying on a side is a look (reported once), and coming back is not also a flick', () => {
    const g = new EyeGestures();
    expect(run(g, 0.6, 3000, 0)).toEqual([{ type: 'look', dir: 'right' }]);
    expect(run(g, 0, 300, 3000)).toEqual([]);
    expect(run(g, -0.6, 1000, 3300)).toEqual([{ type: 'look', dir: 'left' }]);
  });

  it('looking back at the middle after looking at a side is a look at the middle', () => {
    const g = new EyeGestures();
    expect(run(g, -0.6, 1000, 0)).toEqual([{ type: 'look', dir: 'left' }]);
    expect(run(g, 0, 500, 1000)).toEqual([]); // not yet: could be a passing glance
    expect(run(g, 0, 500, 1500)).toEqual([{ type: 'look', dir: 'center' }]);
    expect(run(g, 0, 2000, 2000)).toEqual([]); // reported once
  });

  it('coming back from a flick is not a look at the middle', () => {
    const g = new EyeGestures();
    run(g, -0.6, 300, 0);
    expect(run(g, 0, 2000, 300)).toEqual([{ type: 'flick', dir: 'left' }]);
  });

  it('ignores twitches and small movements', () => {
    const g = new EyeGestures();
    run(g, 0.6, 40, 0); // 2 frames
    expect(run(g, 0, 300, 40)).toEqual([]);
    expect(run(g, 0.15, 1000, 400)).toEqual([]); // below threshold
  });

  it('does nothing while suppressed (blinking)', () => {
    const g = new EyeGestures();
    let n = 0;
    for (let t = 0; t < 2000; t += 33) if (g.update(t, 0.9, true)) n++;
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
    const g = new EyeGestures(tuning);
    let e: GestureEvent | null = null;
    for (let t = 0; t < 1000; t += 33) e ??= g.update(t, -0.4, false);
    expect(e).toEqual({ type: 'look', dir: 'right' }); // still "right"
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

  it('a flick left moves one left, a flick right one right, and it stops at the ends', () => {
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

  it('looking at an option highlights it: left, right, and back to the middle', () => {
    const h = setup();
    h.play(300);
    h.play(1000, -0.6);
    expect(h.lit()).toBe(0);
    h.play(1000, 0.6);
    expect(h.lit()).toBe(2); // straight to the right option, not one step
    h.play(400);
    expect(h.lit()).toBe(2); // a moment in the middle doesn't move it yet
    h.play(600);
    expect(h.lit()).toBe(1); // still looking at the middle: the middle option
  });

  it('the middle option can be selected by looking back at it and waiting', () => {
    const h = setup();
    h.play(300);
    h.play(1000, 0.6); // look at the right option
    h.play(7800); // back to the middle and stay (0.7 s to move there, then 7 s)
    expect(h.selects()).toEqual([{ type: 'select', optionIndex: 1 }]);
  });

  it('after a flick, looking back in the middle keeps the new option', () => {
    const h = setup();
    h.play(300);
    h.play(300, -0.6); // flick left
    h.play(3000);
    expect(h.lit()).toBe(0);
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
