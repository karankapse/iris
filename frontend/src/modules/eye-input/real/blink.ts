import type { EyeTuning } from './tuning';

export type BlinkOutcome = 'select' | 'cancel' | null;

/**
 * Turns a stream of "how closed are the eyes" numbers into deliberate gestures:
 *   closed >= selectMs, then opened  -> 'select'
 *   still closed after cancelMs      -> 'cancel'  (fires while eyes are still closed)
 * Natural blinks (much shorter) are ignored. Pure logic: feed it (time, blinkScore).
 */
export class BlinkDetector {
  private closedAt: number | null = null;
  /** True once this closure has been handled (or must be ignored): wait for the eyes to reopen. */
  private consumed = false;
  private lastEventAt = -Infinity;
  private lastT = -Infinity;

  constructor(private tuning: EyeTuning) {}

  setTuning(tuning: EyeTuning) {
    this.tuning = tuning;
  }

  /** True while the eyes are closed. */
  get closed() {
    return this.closedAt !== null;
  }

  /**
   * Call for every camera frame. `progress` (0..1) is how far the current closure is toward
   * being a deliberate "select" blink, for showing a fill bar.
   */
  update(t: number, blink: number): { outcome: BlinkOutcome; progress: number } {
    const tune = this.tuning;

    // Face was lost for a while: whatever we were tracking is stale, don't act on it.
    if (t - this.lastT > tune.frameGapMs) {
      this.closedAt = null;
      this.consumed = false;
    }
    this.lastT = t;

    let outcome: BlinkOutcome = null;

    if (this.closedAt === null) {
      if (blink >= tune.blinkClose) {
        this.closedAt = t;
        // A blink right after an action is almost certainly part of the same gesture.
        this.consumed = t - this.lastEventAt < tune.cooldownMs;
      }
    } else if (blink <= tune.blinkOpen) {
      const duration = t - this.closedAt;
      if (!this.consumed && duration >= tune.selectMs && duration < tune.cancelMs) {
        outcome = 'select';
        this.lastEventAt = t;
      }
      this.closedAt = null;
      this.consumed = false;
    } else if (!this.consumed && t - this.closedAt >= tune.cancelMs) {
      outcome = 'cancel';
      this.lastEventAt = t;
      this.consumed = true; // don't also 'select' when the eyes finally open
    }

    const progress =
      this.closedAt !== null && !this.consumed
        ? Math.min(1, (t - this.closedAt) / tune.selectMs)
        : 0;
    return { outcome, progress };
  }

  /**
   * The screen changed. If the eyes are closed right now, that closure belongs to the OLD
   * screen: ignore it, so a blink can't select something the user hasn't seen yet.
   */
  invalidate() {
    if (this.closedAt !== null) this.consumed = true;
  }
}
