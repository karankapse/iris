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
