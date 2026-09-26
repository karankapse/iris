import { describe, expect, it, vi } from 'vitest';
import { optionRegions } from '../../../contracts';
import type { EyeEvent, FaceFrame, FaceTracker, GazePoint, ScreenGaze } from '../../../contracts';
import { createEmitter } from '../../../core/emitter';
import { BlinkDetector } from './blink';
import { GazeStepper } from './gaze';
import { RealEyeInput } from './RealEyeInput';
import { DEFAULT_TUNING, median, tuningFromSamples } from './tuning';

const T = DEFAULT_TUNING;

/** Run a BlinkDetector over [blinkScore] frames at 30 fps starting at t0; return outcomes. */
function runBlink(det: BlinkDetector, scores: number[], t0 = 1000, dt = 33) {
  return scores.map((s, i) => det.update(t0 + i * dt, s).outcome);
}
const frames = (n: number, score: number) => Array<number>(n).fill(score);
const outcomes = (o: (string | null)[]) => o.filter(Boolean);

describe('BlinkDetector', () => {
  it('ignores natural blinks (~150 ms)', () => {
    const det = new BlinkDetector(T);
    expect(outcomes(runBlink(det, [0, ...frames(5, 0.9), ...frames(5, 0)]))).toEqual([]);
  });

  it('selects on a deliberate blink (~0.7 s) when the eyes reopen', () => {
    const det = new BlinkDetector(T);
    const o = runBlink(det, [0, ...frames(21, 0.9), ...frames(3, 0)]);
    expect(outcomes(o)).toEqual(['select']);
    expect(o.indexOf('select')).toBeGreaterThan(21); // only once the eyes are open again
  });

  it('cancels while the eyes are still closed after 1.5 s, and does not also select', () => {
    const det = new BlinkDetector(T);
    const o = runBlink(det, [0, ...frames(60, 0.9), ...frames(5, 0)]);
    expect(outcomes(o)).toEqual(['cancel']);
  });

  it('reports progress toward a select blink', () => {
    const det = new BlinkDetector(T);
    det.update(1000, 0.9);
    expect(det.update(1250, 0.9).progress).toBeCloseTo(0.5);
    det.update(1500, 0.9); // frames arrive at least every 300 ms, or the face counts as lost
    expect(det.update(1600, 0.9).progress).toBe(1);
  });

  it('uses hysteresis: a score wobbling between the open and close thresholds is still one blink', () => {
    const det = new BlinkDetector(T);
    const o = runBlink(det, [0, ...frames(8, 0.9), 0.45, 0.5, ...frames(14, 0.9), ...frames(3, 0)]);
    expect(outcomes(o)).toEqual(['select']);
  });

  it('ignores a blink that starts right after a select (same gesture)', () => {
    const det = new BlinkDetector(T);
    const first = runBlink(det, [...frames(20, 0.9), 0], 1000);
    expect(outcomes(first)).toEqual(['select']);
    const second = runBlink(det, [...frames(20, 0.9), 0], 1000 + 22 * 33); // within cooldown
    expect(outcomes(second)).toEqual([]);
  });

  it('invalidate() drops a blink that began on the previous screen', () => {
    const det = new BlinkDetector(T);
    runBlink(det, frames(10, 0.9));
    det.invalidate(); // the screen changed while the eyes were closed
    const o = runBlink(det, [...frames(15, 0.9), ...frames(3, 0)], 1400);
    expect(outcomes(o)).toEqual([]);
    // ...but the next blink works normally
    const later = runBlink(det, [...frames(21, 0.9), ...frames(3, 0)], 10_000);
    expect(outcomes(later)).toEqual(['select']);
  });

  it('forgets a blink in progress if the face disappears for a while', () => {
    const det = new BlinkDetector(T);
    det.update(1000, 0.9); // eyes closed, then tracking is lost for 5 s
    expect(det.update(6000, 0).outcome).toBeNull(); // would be a "5 s blink" if not reset
  });
});

describe('BlinkDetector: double blink (optional "back" gesture)', () => {
  const quickBlink = (det: BlinkDetector, t0: number) => runBlink(det, [...frames(5, 0.9), 0], t0); // ~165 ms closed: a natural-length blink

  it('is off by default: two quick blinks do nothing', () => {
    const det = new BlinkDetector(T);
    const o = [...quickBlink(det, 1000), ...quickBlink(det, 1400)];
    expect(outcomes(o)).toEqual([]);
  });

  it('when on, two quick natural blinks in a row give "double"', () => {
    const det = new BlinkDetector(T);
    det.setDoubleBlink(true);
    const o = [...quickBlink(det, 1000), ...quickBlink(det, 1400)];
    expect(outcomes(o)).toEqual(['double']);
  });

  it('two blinks far apart are just two blinks', () => {
    const det = new BlinkDetector(T);
    det.setDoubleBlink(true);
    const o = [...quickBlink(det, 1000), ...quickBlink(det, 5000)];
    expect(outcomes(o)).toEqual([]);
  });

  it('a deliberate long blink is still a "select", not part of a double blink', () => {
    const det = new BlinkDetector(T);
    det.setDoubleBlink(true);
    const o = [...quickBlink(det, 1000), ...runBlink(det, [...frames(21, 0.9), 0], 1300)];
    expect(outcomes(o)).toEqual(['select']);
  });
});

describe('GazeStepper', () => {
  const step = (g: GazeStepper, ys: number[], t0 = 1000, dt = 33, suppress = false) =>
    ys.map((y, i) => g.update(t0 + i * dt, y, suppress));
  const steps = (s: number[]) => s.filter((x) => x !== 0);

  it('ignores a quick glance but steps when the look is held', () => {
    expect(steps(step(new GazeStepper(T), [0.5, 0.5, 0.5, 0, 0]))).toEqual([]); // ~100 ms glance
    expect(steps(step(new GazeStepper(T), Array(12).fill(0.5)))).toEqual([1]); // ~400 ms hold
  });

  it('looking up steps -1', () => {
    expect(steps(step(new GazeStepper(T), Array(12).fill(-0.5)))).toEqual([-1]);
  });

  it('keeps stepping while the look is held, but only every gazeStepMs', () => {
    const s = step(new GazeStepper(T), Array(80).fill(0.5)); // ~2.6 s
    expect(steps(s).length).toBeGreaterThanOrEqual(3);
    expect(steps(s).length).toBeLessThanOrEqual(4);
  });

  it('does nothing when looking at the middle, or when suppressed (during blinks)', () => {
    expect(steps(step(new GazeStepper(T), Array(40).fill(0.05)))).toEqual([]);
    expect(steps(step(new GazeStepper(T), Array(40).fill(0.9), 1000, 33, true))).toEqual([]);
  });

  it('does not flicker when gaze hovers just around the threshold', () => {
    const g = new GazeStepper(T);
    // enters "down" at 0.31, then wobbles slightly under the threshold but above the release level
    const s = step(g, [0.31, ...Array(15).fill(0.28), ...Array(15).fill(0.26)]);
    expect(steps(s).length).toBeLessThanOrEqual(2); // still one continuous look, stepping at its own pace
  });
});

describe('optionRegions (shared layout)', () => {
  it('places the 3 options in the left, middle and right columns', () => {
    expect(optionRegions(3, 'full')).toEqual(['left', 'middle', 'right']);
    expect(optionRegions(0, 'full')).toEqual([]);
  });
  it('has no columns in vertical mode (options are stacked)', () => {
    expect(optionRegions(3, 'vertical')).toEqual([]);
  });
  it('never returns more than 3', () => {
    expect(optionRegions(9, 'full')).toHaveLength(3);
  });
});

describe('calibration maths', () => {
  it("puts thresholds half way between neutral and the person's own extremes", () => {
    const { tuning, warnings } = tuningFromSamples({
      centerY: 0.1,
      upY: -0.3,
      downY: 0.7,
      openBlink: 0.1,
      closedBlink: 0.9,
    });
    expect(tuning.gazeUp).toBeCloseTo(-0.1);
    expect(tuning.gazeDown).toBeCloseTo(0.4);
    expect(tuning.blinkClose).toBeCloseTo(0.58);
    expect(tuning.blinkOpen).toBeCloseTo(0.38);
    expect(warnings).toEqual([]);
  });

  it('keeps defaults (relative to neutral) and warns when an extreme is indistinguishable', () => {
    const { tuning, warnings } = tuningFromSamples({
      centerY: 0.2,
      upY: 0.19,
      downY: 0.22,
      openBlink: 0.1,
      closedBlink: 0.15,
    });
    expect(tuning.gazeUp).toBeCloseTo(0.2 + DEFAULT_TUNING.gazeUp);
    expect(tuning.gazeDown).toBeCloseTo(0.2 + DEFAULT_TUNING.gazeDown);
    expect(tuning.blinkClose).toBe(DEFAULT_TUNING.blinkClose);
    expect(warnings).toHaveLength(3);
  });

  it('median works for odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

// ---- RealEyeInput end to end with a fake camera ---------------------------------------

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

interface FaceState {
  blink?: number;
  gazeX?: number;
  gazeY?: number;
}

const face = (t: number, o: FaceState = {}): FaceFrame => ({
  t,
  blendshapes: { eyeBlinkLeft: o.blink ?? 0, eyeBlinkRight: o.blink ?? 0 },
  gaze: { x: o.gazeX ?? 0, y: o.gazeY ?? 0 },
  metrics: {},
  landmarks: [],
  headPose: { yaw: 0, pitch: 0, roll: 0 },
});

function setup(optionCount = 3, mode: 'full' | 'vertical' = 'vertical') {
  localStorage.clear(); // tuning is persisted between runs; every test starts from defaults
  const tracker = new FakeTracker();
  const eye = new RealEyeInput(tracker);
  const events: EyeEvent[] = [];
  eye.on((e) => events.push(e));
  eye.start({ mode, optionCount });
  let t = 1000;
  /** Play `ms` of camera frames (30 fps) with the given face state. */
  const play = (ms: number, o: FaceState = {}) => {
    for (const end = t + ms; t < end; t += 33) tracker.emit(face(t, o));
  };
  /** Time passes with no camera frames (e.g. the face is lost). */
  const skip = (ms: number) => {
    t += ms;
  };
  const nonHighlight = () => events.filter((e) => e.type !== 'highlight');
  const highlights = () =>
    events.filter((e): e is Extract<EyeEvent, { type: 'highlight' }> => e.type === 'highlight');
  return { eye, events, play, skip, nonHighlight, highlights };
}

describe('RealEyeInput (vertical mode)', () => {
  it('starts with the first option highlighted', () => {
    const { highlights } = setup();
    expect(highlights().at(-1)?.optionIndex).toBe(0);
  });

  it('looking down moves the highlight down, looking up moves it back', () => {
    const { play, highlights } = setup(3);
    play(500, { gazeY: 0.6 }); // hold a look down
    play(700); // back to the middle
    expect(highlights().at(-1)?.optionIndex).toBe(1);
    play(500, { gazeY: -0.6 });
    play(700);
    expect(highlights().at(-1)?.optionIndex).toBe(0);
  });

  it('never moves past the first or last option', () => {
    const { play, highlights } = setup(2);
    play(4000, { gazeY: 0.9 });
    expect(highlights().at(-1)?.optionIndex).toBe(1);
    play(4000, { gazeY: -0.9 });
    expect(highlights().at(-1)?.optionIndex).toBe(0);
  });

  it('a deliberate blink selects the highlighted option', () => {
    const { play, nonHighlight } = setup(3);
    play(300); // eyes open
    play(700, { blink: 0.9 });
    play(300);
    expect(nonHighlight()).toEqual([{ type: 'select', optionIndex: 0 }]);
  });

  it('a natural blink does nothing', () => {
    const { play, nonHighlight } = setup(3);
    play(300);
    play(160, { blink: 0.9 });
    play(500);
    expect(nonHighlight()).toEqual([]);
  });

  it('holding the eyes closed cancels', () => {
    const { play, nonHighlight } = setup(3);
    play(300);
    play(1700, { blink: 0.9 });
    play(300);
    expect(nonHighlight()).toEqual([{ type: 'cancel' }]);
  });

  it('eyes rolling during a blink do not move the highlight', () => {
    const { play, highlights } = setup(3);
    play(300);
    play(700, { blink: 0.9, gazeY: 0.9 }); // looks "down" while closed
    play(300, { gazeY: 0.9 }); // and while reopening (within settle time)
    expect(highlights().some((h) => h.optionIndex === 1)).toBe(false);
  });

  it('a blink that began before the screen changed is dropped', () => {
    const { eye, play, nonHighlight } = setup(3);
    play(300);
    play(400, { blink: 0.9 });
    eye.setOptionCount(2); // e.g. the partner spoke and new options appeared
    play(500, { blink: 0.9 }); // still closed: total 900 ms, would have been a select
    play(300);
    expect(nonHighlight()).toEqual([]);
  });

  it('resets the highlight to the first option on a new screen', () => {
    const { eye, play, highlights } = setup(3);
    play(600, { gazeY: 0.6 });
    play(600);
    expect(highlights().at(-1)?.optionIndex).toBe(1);
    eye.setOptionCount(4);
    expect(highlights().at(-1)?.optionIndex).toBe(0);
  });

  it('reports blink progress for the fill bar, and clears it afterwards', () => {
    const { play, highlights } = setup(3);
    play(300);
    play(400, { blink: 0.9 });
    expect(Math.max(...highlights().map((h) => h.dwellProgress))).toBeGreaterThan(0.5);
    play(400);
    expect(highlights().at(-1)?.dwellProgress).toBe(0);
  });

  it('with no options, a blink selects nothing', () => {
    const { play, nonHighlight } = setup(0);
    play(300);
    play(700, { blink: 0.9 });
    play(300);
    expect(nonHighlight()).toEqual([]);
  });

  it('calibrate() rejects with a readable message when no face is seen', async () => {
    vi.useFakeTimers();
    const { eye } = setup(3);
    const result = eye.calibrate();
    const assertion = expect(result).rejects.toThrow(/couldn't see the face/);
    await vi.advanceTimersByTimeAsync(4000);
    await assertion;
    vi.useRealTimers();
  });
});

describe('RealEyeInput (full mode, MediaPipe gaze: columns + dwell + blink)', () => {
  /** What the camera reports when looking at each column's words (default, uncalibrated model). */
  const LOOK = {
    left: { gazeX: -0.5, gazeY: 0.5 },
    middle: { gazeX: 0, gazeY: 0.5 },
    right: { gazeX: 0.5, gazeY: 0.5 },
    rest: { gazeX: 0, gazeY: -0.3 },
  };
  /** Rest at the top first, so dwell is armed (as after any screen change). */
  const ready = () => {
    const h = setup(3, 'full');
    h.play(600, LOOK.rest);
    return h;
  };
  const selects = (h: ReturnType<typeof setup>) => h.nonHighlight();

  it('looking at a column highlights the option placed there', () => {
    const h = ready();
    h.play(500, LOOK.left);
    expect(h.highlights().at(-1)?.optionIndex).toBe(0);
    h.play(500, LOOK.middle);
    expect(h.highlights().at(-1)?.optionIndex).toBe(1);
    h.play(500, LOOK.right);
    expect(h.highlights().at(-1)?.optionIndex).toBe(2);
    h.play(500, LOOK.rest);
    expect(h.highlights().at(-1)?.optionIndex).toBeNull(); // top = rest
  });

  it('dwell: holding the gaze on a column fills the bar and then selects that option', () => {
    const h = ready();
    h.play(800, LOOK.right);
    expect(Math.max(...h.highlights().map((e) => e.dwellProgress))).toBeGreaterThan(0.2);
    expect(selects(h)).toEqual([]); // not yet
    h.play(1200, LOOK.right);
    expect(selects(h)).toEqual([{ type: 'select', optionIndex: 2 }]);
  });

  it('a short look does not select', () => {
    const h = ready();
    h.play(700, LOOK.middle);
    h.play(600, LOOK.rest);
    expect(selects(h)).toEqual([]);
  });

  it('a deliberate blink selects the column you are looking at, immediately', () => {
    const h = ready();
    h.play(500, LOOK.middle);
    h.play(700, { blink: 0.9, ...LOOK.middle });
    h.play(300, LOOK.middle);
    expect(selects(h)).toEqual([{ type: 'select', optionIndex: 1 }]);
  });

  it('eyes rolling while blinking do not change what gets selected', () => {
    const h = ready();
    h.play(500, LOOK.left);
    h.play(700, { blink: 0.9, gazeX: 0.9, gazeY: -0.9 }); // gaze numbers go wild while closed
    h.play(300, LOOK.rest);
    expect(selects(h)).toEqual([{ type: 'select', optionIndex: 0 }]);
  });

  it('a blink while resting (looking at the top) selects nothing', () => {
    const h = ready();
    h.play(700, { blink: 0.9, ...LOOK.rest });
    h.play(300, LOOK.rest);
    expect(selects(h)).toEqual([]);
  });

  it('after a selection the same gaze does NOT select again until you look back at the rest area', () => {
    const h = ready();
    h.play(2300, LOOK.left); // dwell completes once...
    expect(selects(h)).toHaveLength(1);
    h.play(3000, LOOK.left); // ...and continuing to stare does nothing more
    expect(selects(h)).toHaveLength(1);
    h.play(500, LOOK.rest); // back to rest: re-armed
    h.play(2300, LOOK.left);
    expect(selects(h)).toHaveLength(2);
  });

  it('a new screen disarms dwell until the gaze has rested (no accidental selection)', () => {
    const h = ready();
    h.play(500, LOOK.right);
    h.eye.setOptionCount(3); // screen changed while the person is still looking right
    h.play(3000, LOOK.right);
    expect(selects(h)).toEqual([]);
    h.play(500, LOOK.rest);
    h.play(2300, LOOK.right);
    expect(selects(h)).toEqual([{ type: 'select', optionIndex: 2 }]);
  });

  it('holding the eyes closed cancels', () => {
    const h = ready();
    h.play(1700, { blink: 0.9, ...LOOK.rest });
    h.play(300, LOOK.rest);
    expect(selects(h)).toEqual([{ type: 'cancel' }]);
  });

  it('losing the face for a moment resets dwell (no selection when it comes back)', () => {
    const h = ready();
    h.play(1000, LOOK.left); // dwell is part-way (1.0 s of 1.5 s)
    h.skip(2000); // no frames for 2 s: the face was lost
    h.play(1000, LOOK.left); // reappears still looking there: old dwell must not carry over
    expect(selects(h)).toEqual([]);
  });

  it('reports which zone it currently sees, for the camera panel', () => {
    const h = ready();
    h.play(500, LOOK.right);
    expect(h.eye.status?.().region).toBe('right');
  });
});

// ---- screen gaze (WebGazer / mouse): zones come from real screen coordinates ------------------

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

describe('RealEyeInput (screen gaze: which box on the screen is the gaze in?)', () => {
  const W = window.innerWidth; // jsdom: 1024 x 768
  const H = window.innerHeight;
  // the words at the bottom of each column, and the rest area at the top
  const spots = {
    left: { x: W * 0.15, y: H * 0.8 },
    middle: { x: W * 0.5, y: H * 0.8 },
    right: { x: W * 0.85, y: H * 0.8 },
    mid: { x: W * 0.5, y: H * 0.25 },
  };

  function setupGaze(n = 3) {
    localStorage.clear();
    const tracker = new FakeTracker();
    const gaze = new FakeGaze();
    const eye = new RealEyeInput(tracker, gaze);
    const events: EyeEvent[] = [];
    eye.on((e) => events.push(e));
    eye.start({ mode: 'full', optionCount: n });
    let t = 1000;
    /** Camera frames (blinks) and gaze estimates arrive together, ~30 per second. */
    const play = (ms: number, at: { x: number; y: number }, blink = 0) => {
      for (const end = t + ms; t < end; t += 33) {
        tracker.emit(face(t, { blink }));
        gaze.emit({ x: at.x, y: at.y, t });
      }
    };
    const selects = () => events.filter((e) => e.type !== 'highlight');
    const lit = () =>
      events.filter((e): e is Extract<EyeEvent, { type: 'highlight' }> => e.type === 'highlight');
    return { eye, gaze, play, selects, lit };
  }

  it('lights up the option whose box the gaze is in', () => {
    const h = setupGaze();
    h.play(600, spots.mid);
    h.play(500, spots.left);
    expect(h.lit().at(-1)?.optionIndex).toBe(0);
    h.play(500, spots.right);
    expect(h.lit().at(-1)?.optionIndex).toBe(2);
    h.play(500, spots.mid);
    expect(h.lit().at(-1)?.optionIndex).toBeNull();
  });

  it('selects by dwell (look and keep looking), and only once', () => {
    const h = setupGaze();
    h.play(600, spots.mid);
    h.play(2500, spots.middle);
    expect(h.selects()).toEqual([{ type: 'select', optionIndex: 1 }]);
  });

  it('selects by a deliberate blink while looking at a box', () => {
    const h = setupGaze();
    h.play(600, spots.mid);
    h.play(600, spots.right);
    h.play(700, spots.right, 0.9);
    h.play(300, spots.right);
    expect(h.selects()).toEqual([{ type: 'select', optionIndex: 2 }]);
  });

  it('a gaze that wanders off while the eyes are closed does not change the selection', () => {
    const h = setupGaze();
    h.play(600, spots.mid);
    h.play(600, spots.left);
    h.play(700, spots.right, 0.9); // gaze estimates jump while the eyes are closed
    h.play(300, spots.mid);
    expect(h.selects()).toEqual([{ type: 'select', optionIndex: 0 }]);
  });

  it('a new screen needs a look at the middle before dwell can select (no accidental pick)', () => {
    const h = setupGaze();
    h.play(600, spots.mid);
    h.play(500, spots.left);
    h.eye.setOptionCount(3);
    h.play(3000, spots.left);
    expect(h.selects()).toEqual([]);
  });

  it('does nothing while looking at the middle (rest)', () => {
    const h = setupGaze();
    h.play(4000, spots.mid);
    expect(h.selects()).toEqual([]);
  });

  it('reports the current zone for the camera panel', () => {
    const h = setupGaze();
    h.play(600, spots.mid);
    h.play(600, spots.right);
    expect(h.eye.status?.().region).toBe('right');
  });
});

describe('RealEyeInput.configure (user settings)', () => {
  it('a longer dwell setting makes selection slower, a shorter one faster', () => {
    const at = { x: window.innerWidth * 0.85, y: window.innerHeight * 0.8 }; // right column's words
    const run = (dwellMs: number, lookMs: number) => {
      localStorage.clear();
      const tracker = new FakeTracker();
      const gaze = new FakeGaze();
      const eye = new RealEyeInput(tracker, gaze);
      eye.configure({ dwellMs, blinkMs: 500, steadinessMs: 150, doubleBlinkBack: false });
      const events: EyeEvent[] = [];
      eye.on((e) => events.push(e));
      eye.start({ mode: 'full', optionCount: 3 });
      let t = 1000;
      const play = (ms: number, p: { x: number; y: number }) => {
        for (const end = t + ms; t < end; t += 33) {
          tracker.emit(face(t));
          gaze.emit({ ...p, t });
        }
      };
      play(600, { x: window.innerWidth / 2, y: window.innerHeight * 0.25 }); // rest
      play(lookMs, at);
      return events.filter((e) => e.type === 'select').length;
    };
    expect(run(800, 1400)).toBe(1); // short dwell: selected after 1.4 s
    expect(run(3000, 1400)).toBe(0); // long dwell: not yet
    expect(run(3000, 3600)).toBe(1); // ...but selected if you keep looking
  });

  it('a longer blink setting means a 600 ms blink is no longer deliberate', () => {
    localStorage.clear();
    const tracker = new FakeTracker();
    const eye = new RealEyeInput(tracker, null);
    eye.configure({ dwellMs: 1500, blinkMs: 900, steadinessMs: 150, doubleBlinkBack: false });
    const events: EyeEvent[] = [];
    eye.on((e) => events.push(e));
    eye.start({ mode: 'vertical', optionCount: 3 });
    let t = 1000;
    const play = (ms: number, blink: number) => {
      for (const end = t + ms; t < end; t += 33) tracker.emit(face(t, { blink }));
    };
    play(300, 0);
    play(600, 0.9);
    play(300, 0);
    expect(events.filter((e) => e.type === 'select')).toEqual([]);
    play(1000, 0.9);
    play(300, 0);
    expect(events.filter((e) => e.type === 'select').length).toBe(1);
  });
});
