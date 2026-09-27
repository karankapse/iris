// Tests for the gaze/blink upgrades: EAR blinks with a per-user threshold, the refractory period,
// the dwell radius, the debug stream and live tuning.
import { describe, expect, it } from 'vitest';
import type { EyeEvent, FaceFrame, FaceTracker, GazePoint, ScreenGaze } from '../../../contracts';
import { createEmitter } from '../../../core/emitter';
import { RealEyeInput, type EyeDebugState } from './RealEyeInput';
import { DEFAULT_TUNING, earCalibration, earClosure, earThreshold } from './tuning';

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

/** A frame with landmarks-based EAR (and blendshapes that would NOT count as closed). */
const frame = (t: number, ear: number): FaceFrame => ({
  t,
  blendshapes: { eyeBlinkLeft: 0, eyeBlinkRight: 0 },
  gaze: { x: 0, y: 0 },
  metrics: { ear },
  landmarks: [],
  headPose: { yaw: 0, pitch: 0, roll: 0 },
});

const OPEN = 0.3;
const CLOSED = 0.05;

function setup(mode: 'full' | 'vertical', withGaze = false) {
  localStorage.clear();
  const tracker = new FakeTracker();
  const gaze = withGaze ? new FakeGaze() : null;
  const eye = new RealEyeInput(tracker, gaze);
  const events: EyeEvent[] = [];
  eye.on((e) => events.push(e));
  eye.start({ mode, optionCount: 3 });
  let t = 1000;
  const play = (ms: number, ear = OPEN, at?: { x: number; y: number }) => {
    for (const end = t + ms; t < end; t += 33) {
      tracker.emit(frame(t, ear));
      if (at) gaze?.emit({ ...at, t });
    }
  };
  const selects = () => events.filter((e) => e.type === 'select');
  return { eye, play, selects };
}

describe('EAR helpers', () => {
  it('learns open/closed EAR from calibration frames, ignoring frames without landmarks', () => {
    const open = [...Array(20).fill(0.3), 0, 0];
    const closed = Array(20).fill(0.06);
    expect(earCalibration(open, closed)).toEqual({ earOpen: 0.3, earClosed: 0.06 });
  });

  it("refuses when open and closed can't be told apart, or there's too little data", () => {
    expect(earCalibration(Array(20).fill(0.3), Array(20).fill(0.28))).toBeNull();
    expect(earCalibration(Array(5).fill(0.3), Array(20).fill(0.05))).toBeNull();
  });

  it('scales closure to the person, and reports the EAR threshold', () => {
    const tune = { ...DEFAULT_TUNING, earOpen: 0.3, earClosed: 0.1, blinkClose: 0.5 };
    expect(earClosure(0.3, tune)).toBe(0);
    expect(earClosure(0.2, tune)).toBeCloseTo(0.5);
    expect(earClosure(0.02, tune)).toBe(1);
    expect(earThreshold(tune)).toBeCloseTo(0.2);
  });
});

describe('RealEyeInput with EAR blinks', () => {
  it('ignores natural blinks and selects on a deliberate one', () => {
    const h = setup('vertical');
    h.play(500);
    h.play(200, CLOSED); // natural blink
    h.play(900);
    expect(h.selects()).toEqual([]);
    h.play(650, CLOSED); // deliberate (>= selectMs 500)
    h.play(300);
    expect(h.selects()).toEqual([{ type: 'select', optionIndex: 0 }]);
  });

  it('can be switched back to the blendshapes (EAR frames then never count as closed)', () => {
    const h = setup('vertical');
    h.eye.setTuning({ useEar: 0 });
    h.play(500);
    h.play(700, CLOSED);
    h.play(300);
    expect(h.selects()).toEqual([]);
  });
});

describe('refractory period', () => {
  it('drops a second selection that comes too soon, then allows it again', () => {
    const h = setup('vertical');
    h.eye.setTuning({ cooldownMs: 0, refractoryMs: 1500 }); // only the refractory period guards
    h.play(300);
    h.play(600, CLOSED);
    h.play(200);
    h.play(600, CLOSED); // ~800 ms after the first: ignored
    h.play(200);
    expect(h.selects()).toHaveLength(1);
    h.play(1500);
    h.play(600, CLOSED);
    h.play(200);
    expect(h.selects()).toHaveLength(2);
  });
});

describe('dwell radius', () => {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const rest = { x: W * 0.5, y: H * 0.25 };

  it('selects when the gaze stays inside the target circle', () => {
    const h = setup('full', true);
    h.play(600, OPEN, rest);
    h.play(2500, OPEN, { x: W * 0.83, y: H * 0.84 }); // right column's words
    expect(h.selects()).toEqual([{ type: 'select', optionIndex: 2 }]);
  });

  it('never completes while the gaze is in the column but outside the circle', () => {
    const h = setup('full', true);
    h.play(600, OPEN, rest);
    h.play(3000, OPEN, { x: W * 0.83, y: H * 0.53 }); // top of the right column, far from the words
    expect(h.selects()).toEqual([]);
  });

  it('resets when the gaze leaves the circle', () => {
    const h = setup('full', true);
    h.eye.setTuning({ dwellMs: 1500 });
    h.play(600, OPEN, rest);
    h.play(1000, OPEN, { x: W * 0.83, y: H * 0.84 }); // 2/3 of the way
    h.play(300, OPEN, { x: W * 0.83, y: H * 0.53 }); // out of the circle (still the right column)
    h.play(1000, OPEN, { x: W * 0.83, y: H * 0.84 }); // back: starts over, not enough yet
    expect(h.selects()).toEqual([]);
    h.play(600, OPEN, { x: W * 0.83, y: H * 0.84 });
    expect(h.selects()).toHaveLength(1);
  });
});

describe('dwell tolerance', () => {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const words = { x: W * 0.83, y: H * 0.84 };
  const away = { x: W * 0.83, y: H * 0.53 }; // same column, outside the target circle

  it('a stray moment outside the circle only pauses the dwell', () => {
    const h = setup('full', true);
    h.eye.setTuning({ dwellMs: 1500, dwellGraceMs: 250 });
    h.play(600, OPEN, { x: W * 0.5, y: H * 0.25 });
    h.play(1000, OPEN, words);
    h.play(100, OPEN, away); // one noisy blip
    h.play(900, OPEN, words); // 1.0 + 0.9 s inside: enough (alone, 0.9 s is not), no reset
    expect(h.selects()).toHaveLength(1);
  });

  it('with fixation detection on, eyes sweeping around never fill the dwell', () => {
    const h = setup('full', true);
    h.eye.setTuning({ dwellMs: 1000, fixSpread: 0.05, fixWindowMs: 150 });
    h.play(600, OPEN, { x: W * 0.5, y: H * 0.25 });
    // moving back and forth inside the circle (e.g. smooth pursuit / drift), never holding still
    for (let i = 0; i < 30; i++) h.play(66, OPEN, { x: words.x + (i % 2 ? 90 : -90), y: words.y });
    expect(h.selects()).toEqual([]);
    h.play(1500, OPEN, words); // now holding still
    expect(h.selects()).toHaveLength(1);
  });
});

describe('stale screen gaze', () => {
  it('never completes a dwell from camera frames alone once gaze points stop coming', () => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const h = setup('full', true);
    h.play(600, OPEN, { x: W * 0.5, y: H * 0.25 });
    h.play(400, OPEN, { x: W * 0.83, y: H * 0.84 }); // start a dwell on the right option...
    h.play(3000, OPEN); // ...then the gaze tracker goes quiet while the face tracker carries on
    expect(h.selects()).toEqual([]);
  });
});

describe('debug stream and live tuning', () => {
  it('reports EAR, the threshold, the zone and dwell progress', () => {
    const h = setup('full', true);
    const states: EyeDebugState[] = [];
    h.eye.onDebug((s) => states.push(s));
    h.play(600, OPEN, rest());
    h.play(700, OPEN, { x: window.innerWidth * 0.5, y: window.innerHeight * 0.84 });
    const last = states.at(-1)!;
    expect(last.ear).toBeCloseTo(OPEN);
    expect(last.earThreshold).toBeCloseTo(earThreshold(h.eye.getTuning()));
    expect(last.zone).toBe('middle');
    expect(last.dwellProgress).toBeGreaterThan(0.2);
    expect(last.target?.r).toBeCloseTo(DEFAULT_TUNING.dwellRadius * window.innerWidth);
  });

  it('setTuning changes behaviour immediately and is saved', () => {
    const h = setup('full', true);
    h.eye.setTuning({ dwellMs: 600 });
    h.play(600, OPEN, rest());
    // 1.2 s: under the default 1.5 s dwell, over the new 0.6 s (plus the zone's hold time)
    h.play(1200, OPEN, { x: window.innerWidth * 0.5, y: window.innerHeight * 0.84 });
    expect(h.selects()).toHaveLength(1);
    expect(new RealEyeInput(new FakeTracker()).getTuning().dwellMs).toBe(600);
  });

  function rest() {
    return { x: window.innerWidth * 0.5, y: window.innerHeight * 0.25 };
  }
});
