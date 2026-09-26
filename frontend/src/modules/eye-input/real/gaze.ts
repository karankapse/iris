import type { Region } from '../../../contracts';
import type { EyeTuning } from './tuning';

/** Once looking up/down, gaze.y must come this far back toward the middle to "let go". */
const HYSTERESIS = 0.05;

/**
 * Turns "how far up/down are the eyes looking" (gaze.y, up is negative) into steps:
 * -1 = move the highlight up, +1 = down. Look and hold to move; keep holding to keep moving.
 * Webcam gaze is coarse, so we step through the options instead of pointing at them.
 */
export class GazeStepper {
  private direction: -1 | 0 | 1 = 0;
  private heldSince = 0;
  private lastStepAt = -Infinity;

  constructor(private tuning: EyeTuning) {}

  setTuning(tuning: EyeTuning) {
    this.tuning = tuning;
  }

  /** `suppress`: ignore gaze right now (eyes closing/opening, or just after a blink). */
  update(t: number, y: number, suppress: boolean): -1 | 0 | 1 {
    const { gazeUp, gazeDown, gazeHoldMs, gazeStepMs } = this.tuning;

    // Hysteresis: once looking in a direction, only let go after coming a bit back toward the
    // middle, so a value hovering right at the threshold doesn't flicker on and off.
    const upLimit = this.direction === -1 ? gazeUp + HYSTERESIS : gazeUp;
    const downLimit = this.direction === 1 ? gazeDown - HYSTERESIS : gazeDown;
    const now: -1 | 0 | 1 = suppress ? 0 : y <= upLimit ? -1 : y >= downLimit ? 1 : 0;

    if (now !== this.direction) {
      this.direction = now;
      this.heldSince = t;
    }
    if (now !== 0 && t - this.heldSince >= gazeHoldMs && t - this.lastStepAt >= gazeStepMs) {
      this.lastStepAt = t;
      return now;
    }
    return 0;
  }

  reset() {
    this.direction = 0;
  }
}

// ============================================================================================
// Coarse gaze REGIONS (full mode): which of up / down / left / right is the person looking at?
// ============================================================================================

export type GazeRegion = Region | 'center';

/** A different region must beat the current one by this much before we switch to it. */
const SWITCH_MARGIN = 0.1;

/**
 * Classifies (x, y) gaze into up / down / left / right / center, using this person's
 * calibrated thresholds. Webcam gaze is noisy, so a region must (1) be beyond its threshold,
 * (2) stay the best candidate for `regionHoldMs`, and (3) once entered, is kept until the gaze
 * comes back well inside it (hysteresis).
 */
export class RegionTracker {
  current: GazeRegion = 'center';
  private candidate: GazeRegion = 'center';
  private candidateSince = 0;

  constructor(private tuning: EyeTuning) {}

  setTuning(tuning: EyeTuning) {
    this.tuning = tuning;
  }

  /** How far past its threshold the gaze is for a region (>= 0 means "inside" it). */
  private excess(region: Region, x: number, y: number): number {
    const t = this.tuning;
    const xr = x * t.gazeXSign; // now: negative = user's left, positive = user's right
    switch (region) {
      case 'up':
        return t.gazeUp - y;
      case 'down':
        return y - t.gazeDown;
      case 'left':
        return t.gazeLeft - xr;
      case 'right':
        return xr - t.gazeRight;
    }
  }

  /**
   * `suppress`: freeze (eyes are closing/opening: gaze numbers are unreliable). The region we had
   * just before stays current, which is what lets a blink select "the thing I was looking at".
   * `sides`: false in vertical mode, where left/right are ignored.
   */
  update(t: number, x: number, y: number, suppress: boolean, sides: boolean): GazeRegion {
    if (suppress) return this.current;

    const regions: Region[] = sides ? ['up', 'down', 'left', 'right'] : ['up', 'down'];
    let best: GazeRegion = 'center';
    let bestExcess = -1;
    for (const r of regions) {
      const e = this.excess(r, x, y);
      if (e >= 0 && e > bestExcess) {
        best = r;
        bestExcess = e;
      }
    }

    let target: GazeRegion = best;
    if (this.current !== 'center' && regions.includes(this.current)) {
      const currentExcess = this.excess(this.current, x, y);
      const stillInside = currentExcess >= -HYSTERESIS;
      const clearlyBeaten =
        best !== 'center' && best !== this.current && bestExcess > currentExcess + SWITCH_MARGIN;
      if (stillInside && !clearlyBeaten) target = this.current;
    }

    if (target !== this.candidate) {
      this.candidate = target;
      this.candidateSince = t;
    }
    if (this.candidate !== this.current && t - this.candidateSince >= this.tuning.regionHoldMs) {
      this.current = this.candidate;
    }
    return this.current;
  }

  reset() {
    this.current = 'center';
    this.candidate = 'center';
  }
}
