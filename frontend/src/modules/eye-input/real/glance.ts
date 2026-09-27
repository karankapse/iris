// GLANCE control: a quick look to the LEFT moves the highlight one option left, a quick look to
// the RIGHT moves it one option right. It reads the eye movement itself (from the face tracking),
// not where on the screen the person is looking, so it works even when screen-gaze tracking is
// poor. One glance = one step: the eyes must come back to the middle before the next step.
import type { FaceFrame } from '../../../contracts';
import { median } from './tuning';

/** Which horizontal eye signal to use. Calibration picks whichever separates left/right better. */
export type GlanceSignal = 'blend' | 'iris';

export interface GlanceTuning {
  signal: GlanceSignal;
  /** The signal's value when looking straight ahead. */
  center: number;
  /** +1 if the signal goes UP when looking right, -1 if it goes down. */
  sign: 1 | -1;
  /** How far from center (in signal units) counts as a glance. */
  threshold: number;
  /** A glance must last this long to count (filters twitches). */
  holdMs: number;
}

export const DEFAULT_GLANCE: GlanceTuning = {
  signal: 'blend',
  center: 0,
  sign: 1,
  threshold: 0.3,
  holdMs: 120,
};

/**
 * The horizontal eye signal for one frame:
 *  'blend': MediaPipe's own eye-rotation estimate (eyeLook* blendshapes); + is toward the right
 *  'iris':  where the iris sits in the eye, from landmarks; camera-image direction (sign learned)
 */
export function glanceValue(frame: FaceFrame, signal: GlanceSignal): number {
  return signal === 'iris' ? (frame.metrics.irisX ?? 0) : frame.gaze.x;
}

type Dir = 'left' | 'center' | 'right';

export class GlanceStepper {
  private dir: Dir = 'center';
  private candidate: Dir = 'center';
  private since = 0;
  /** A step was already made for the current glance (wait for a return to the middle). */
  private fired = false;
  private center: number;

  constructor(private tuning: GlanceTuning = DEFAULT_GLANCE) {
    this.center = tuning.center;
  }

  setTuning(tuning: GlanceTuning) {
    this.tuning = tuning;
    this.center = tuning.center;
    this.reset();
  }

  get glancing() {
    return this.candidate !== 'center';
  }

  /** -1 = one step left, +1 = one step right, 0 = nothing. `suppress` = eyes closing/opening. */
  update(t: number, value: number, suppress: boolean): -1 | 0 | 1 {
    if (suppress) return 0;
    const { threshold, sign, holdMs } = this.tuning;
    const d = (value - this.center) * sign; // + = looking right

    // hysteresis: to leave a glance the eyes must come clearly back toward the middle
    let now: Dir;
    if (d <= -threshold) now = 'left';
    else if (d >= threshold) now = 'right';
    else if (Math.abs(d) < threshold * 0.5) now = 'center';
    else now = this.dir; // in between: keep what we had

    // looking straight: slowly follow the resting position (posture drifts over time)
    if (now === 'center') this.center += 0.02 * (value - this.center);

    if (now !== this.candidate) {
      this.candidate = now;
      this.since = t;
    }
    if (t - this.since < holdMs) return 0;
    this.dir = this.candidate;

    if (this.dir === 'center') {
      this.fired = false; // back to the middle: ready for the next glance
      return 0;
    }
    if (this.fired) return 0;
    this.fired = true;
    return this.dir === 'left' ? -1 : 1;
  }

  reset() {
    this.dir = 'center';
    this.candidate = 'center';
    this.fired = false;
  }
}

// ---- calibration: straight / left / right -------------------------------------------------

export interface GlanceSamples {
  center: FaceFrame[];
  left: FaceFrame[];
  right: FaceFrame[];
}

function std(values: number[]): number {
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / values.length) || 1e-6;
}

/**
 * Learn this person's glance: which signal separates left from right best, which way is right,
 * and a threshold half-way between straight and their weaker side. Warns if the glances were
 * too small to tell apart.
 */
export function glanceFromSamples(
  s: GlanceSamples,
  base: GlanceTuning = DEFAULT_GLANCE,
): { tuning: GlanceTuning; warnings: string[] } {
  const score = (signal: GlanceSignal) => {
    const vals = (fs: FaceFrame[]) => fs.map((f) => glanceValue(f, signal));
    const c = median(vals(s.center));
    const l = median(vals(s.left));
    const r = median(vals(s.right));
    // how far the weaker glance moves, compared to the jitter while looking straight
    const noise = std(vals(s.center));
    return { signal, c, l, r, separation: Math.min(Math.abs(l - c), Math.abs(r - c)) / noise };
  };
  const best = [score('blend'), score('iris')].sort((a, b) => b.separation - a.separation)[0];
  const sign: 1 | -1 = best.r >= best.l ? 1 : -1;
  const toLeft = Math.abs(best.l - best.c);
  const toRight = Math.abs(best.r - best.c);
  const warnings: string[] = [];
  if (Math.sign((best.r - best.c) * sign) <= 0 || Math.sign((best.c - best.l) * sign) <= 0) {
    warnings.push(
      'Left and right glances were not on opposite sides of looking straight. Try again, glancing further.',
    );
  }
  if (best.separation < 2) {
    warnings.push('The glances were small compared to eye jitter. Glance further left and right.');
  }
  return {
    tuning: {
      ...base,
      signal: best.signal,
      center: best.c,
      sign,
      // half-way to the weaker side, so both directions trigger reliably
      threshold: Math.max(0.5 * Math.min(toLeft, toRight), 1e-3),
    },
    warnings,
  };
}

const KEY = 'iris.glance.v1';

export function loadGlance(): GlanceTuning | null {
  try {
    const g = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return g && (g.signal === 'blend' || g.signal === 'iris') && Number.isFinite(g.threshold)
      ? g
      : null;
  } catch {
    return null;
  }
}

export function saveGlance(g: GlanceTuning) {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    /* ignore */
  }
}
