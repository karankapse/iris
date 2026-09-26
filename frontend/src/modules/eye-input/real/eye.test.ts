import { describe, expect, it, vi } from 'vitest';
import { optionRegions } from '../../../contracts';
import type { EyeEvent, FaceFrame, FaceTracker } from '../../../contracts';
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
  it('places options in the screen corners, in reading order', () => {
    expect(optionRegions(4, 'full')).toEqual(['up-left', 'up-right', 'down-left', 'down-right']);
    expect(optionRegions(3, 'full')).toEqual(['up-left', 'up-right', 'down-left']);
    expect(optionRegions(2, 'full')).toEqual(['up-left', 'up-right']);
    expect(optionRegions(1, 'full')).toEqual(['up-left']);
    expect(optionRegions(0, 'full')).toEqual([]);
  });
  it('has no corners in vertical mode (options are stacked)', () => {
    expect(optionRegions(4, 'vertical')).toEqual([]);
  });
  it('never returns more than 4', () => {
    expect(optionRegions(9, 'full')).toHaveLength(4);
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

describe('RealEyeInput (full mode: corners + dwell + blink)', () => {
  /** What the camera reports when looking at each corner (default, uncalibrated model). */
  const LOOK = {
    tl: { gazeX: -0.5, gazeY: -0.4 },
    tr: { gazeX: 0.5, gazeY: -0.4 },
    bl: { gazeX: -0.5, gazeY: 0.6 },
    br: { gazeX: 0.5, gazeY: 0.6 },
  };
  /** Rest at the centre first, so dwell is armed (as after any screen change). */
  const ready = (n = 4) => {
    const h = setup(n, 'full');
    h.play(600);
    return h;
  };
  const selects = (h: ReturnType<typeof setup>) => h.nonHighlight();

  it('looking at a corner highlights the option placed there (reading order)', () => {
    const h = ready(4);
    h.play(500, LOOK.tl);
    expect(h.highlights().at(-1)?.optionIndex).toBe(0);
    h.play(500, LOOK.tr);
    expect(h.highlights().at(-1)?.optionIndex).toBe(1);
    h.play(500, LOOK.bl);
    expect(h.highlights().at(-1)?.optionIndex).toBe(2);
    h.play(500, LOOK.br);
    expect(h.highlights().at(-1)?.optionIndex).toBe(3);
    h.play(500);
    expect(h.highlights().at(-1)?.optionIndex).toBeNull(); // centre = rest
  });

  it('dwell: holding the gaze on a corner fills the bar and then selects that option', () => {
    const h = ready(4);
    h.play(800, LOOK.tr);
    expect(Math.max(...h.highlights().map((e) => e.dwellProgress))).toBeGreaterThan(0.2);
    expect(selects(h)).toEqual([]); // not yet
    h.play(1200, LOOK.tr);
    expect(selects(h)).toEqual([{ type: 'select', optionIndex: 1 }]);
  });

  it('a short look does not select', () => {
    const h = ready(4);
    h.play(700, LOOK.br);
    h.play(600);
    expect(selects(h)).toEqual([]);
  });

  it('a deliberate blink selects the corner you are looking at, immediately', () => {
    const h = ready(4);
    h.play(500, LOOK.bl);
    h.play(700, { blink: 0.9, ...LOOK.bl });
    h.play(300, LOOK.bl);
    expect(selects(h)).toEqual([{ type: 'select', optionIndex: 2 }]);
  });

  it('eyes rolling while blinking do not change what gets selected', () => {
    const h = ready(4);
    h.play(500, LOOK.tr);
    h.play(700, { blink: 0.9, gazeX: -0.9, gazeY: 0.9 }); // gaze numbers go wild while closed
    h.play(300);
    expect(selects(h)).toEqual([{ type: 'select', optionIndex: 1 }]);
  });

  it('a blink while looking at the centre selects nothing', () => {
    const h = ready(4);
    h.play(700, { blink: 0.9 });
    h.play(300);
    expect(selects(h)).toEqual([]);
  });

  it('after a selection the same gaze does NOT select again until you look back at the centre', () => {
    const h = ready(4);
    h.play(2300, LOOK.tl); // dwell completes once...
    expect(selects(h)).toHaveLength(1);
    h.play(3000, LOOK.tl); // ...and continuing to stare does nothing more
    expect(selects(h)).toHaveLength(1);
    h.play(500); // back to the centre: re-armed
    h.play(2300, LOOK.tl);
    expect(selects(h)).toHaveLength(2);
  });

  it('a new screen disarms dwell until the gaze has rested at the centre (no accidental selection)', () => {
    const h = ready(4);
    h.play(500, LOOK.tr);
    h.eye.setOptionCount(2); // screen changed while the person is still looking top-right
    h.play(3000, LOOK.tr);
    expect(selects(h)).toEqual([]);
    h.play(500); // rest
    h.play(2300, LOOK.tr);
    expect(selects(h)).toEqual([{ type: 'select', optionIndex: 1 }]);
  });

  it('looking at a corner with no option there highlights nothing (2 options: top row only)', () => {
    const h = ready(2);
    h.play(500, LOOK.bl);
    expect(h.highlights().every((e) => e.optionIndex === null)).toBe(true);
    h.play(3000, LOOK.bl);
    expect(selects(h)).toEqual([]);
  });

  it('holding the eyes closed cancels', () => {
    const h = ready(4);
    h.play(1700, { blink: 0.9 });
    h.play(300);
    expect(selects(h)).toEqual([{ type: 'cancel' }]);
  });

  it('losing the face for a moment resets dwell (no selection when it comes back)', () => {
    const h = ready(4);
    h.play(1000, LOOK.tl); // dwell is part-way (1.0 s of 1.5 s)
    h.skip(2000); // no frames for 2 s: the face was lost
    h.play(1000, LOOK.tl); // reappears still looking there: old dwell must not carry over
    expect(selects(h)).toEqual([]);
  });

  it('reports which corner it currently sees, for the camera panel', () => {
    const h = ready(4);
    h.play(500, LOOK.br);
    expect(h.eye.status?.().region).toBe('down-right');
  });
});
