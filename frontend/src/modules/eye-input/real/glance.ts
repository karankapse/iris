// GLANCE control, two gestures read from the horizontal eye movement (face tracking):
//   LOOK at a side and keep looking  -> that side's option is highlighted directly
//   LOOK back at the middle (after looking at a side) -> the middle option
//   FLICK the eyes out and back      -> the highlight moves one option that way
// Which one it is depends on how long the eyes stay out: a flick comes back quickly.
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
  /** A flick must last this long to count (filters twitches). */
  holdMs: number;
  /** Eyes out and back within this time = a FLICK; staying out longer = LOOKING at that side. */
  flickMaxMs: number;
  /** After LOOKING at a side, eyes back in the middle this long = looking at the middle option. */
  centerHoldMs: number;
}

export const DEFAULT_GLANCE: GlanceTuning = {
  signal: 'blend',
  center: 0,
  sign: 1,
  threshold: 0.3,
  holdMs: 80,
  flickMaxMs: 600,
  centerHoldMs: 700,
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

export type GestureEvent =
  | { type: 'look'; dir: 'left' | 'center' | 'right' } // eyes stayed there: highlight that option
  | { type: 'flick'; dir: 'left' | 'right' }; // out and back quickly: move one option that way

export class EyeGestures {
  private dir: Dir = 'center';
  private outSince = 0;
  /** A 'look' was already reported for the current time out (report it once). */
  private looked = false;
  /** Came back to the middle after LOOKING at a side (not a flick): since when. */
  private backSince: number | null = null;
  private center: number;

  constructor(private tuning: GlanceTuning = DEFAULT_GLANCE) {
    this.center = tuning.center;
  }

  setTuning(tuning: GlanceTuning) {
    this.tuning = tuning;
    this.center = tuning.center;
    this.reset();
  }

  /** `suppress` = eyes closing/opening (the numbers are unreliable): ignore the frame. */
  update(t: number, value: number, suppress: boolean): GestureEvent | null {
    if (suppress) return null;
    const { threshold, sign, holdMs, flickMaxMs, centerHoldMs } = this.tuning;
    const d = (value - this.center) * sign; // + = looking right

    // hysteresis: to count as back in the middle, the eyes must come clearly back
    let now: Dir;
    if (d <= -threshold) now = 'left';
    else if (d >= threshold) now = 'right';
    else if (Math.abs(d) < threshold * 0.5) now = 'center';
    else now = this.dir;

    // looking straight: slowly follow the resting position (posture drifts over time)
    if (now === 'center') this.center += 0.02 * (value - this.center);

    let event: GestureEvent | null = null;
    if (now !== this.dir) {
      if (this.dir !== 'center' && now === 'center') {
        // came back: a quick out-and-back is a flick (a long stay was already a 'look')
        const out = t - this.outSince;
        if (!this.looked && out >= holdMs && out <= flickMaxMs) {
          event = { type: 'flick', dir: this.dir };
        }
        // back from LOOKING at a side: if the eyes stay here, they're looking at the middle
        this.backSince = this.looked ? t : null;
      }
      if (now !== 'center') {
        this.outSince = t;
        this.looked = false;
        this.backSince = null;
      }
      this.dir = now;
    } else if (now !== 'center' && !this.looked && t - this.outSince > flickMaxMs) {
      this.looked = true; // stayed out: they are LOOKING at that side
      event = { type: 'look', dir: now };
    } else if (now === 'center' && this.backSince !== null && t - this.backSince >= centerHoldMs) {
      this.backSince = null;
      event = { type: 'look', dir: 'center' };
    }
    return event;
  }

  reset() {
    this.dir = 'center';
    this.looked = false;
    this.backSince = null;
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
      'Left and right were not on opposite sides of looking straight. Try again, eyes only.',
    );
  }
  if (best.separation < 2) {
    warnings.push('Left and right looked too similar. Look right at each option, head still.');
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
      ? { ...DEFAULT_GLANCE, ...g } // fill in settings added later (e.g. flickMaxMs)
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
