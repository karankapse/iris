/**
 * One Euro filter (Casiez, Roussel & Vogel, CHI 2012): a low-pass filter whose cutoff rises
 * with speed. When the gaze is still it smooths hard (no jitter); when the eyes jump it lets the
 * movement through almost immediately (no lag). A plain moving average can only trade one for
 * the other.
 *
 *   minCutoff  (Hz) smoothing when still: lower = steadier, but slower to settle
 *   beta           how quickly the cutoff opens up with speed: higher = less lag on fast moves
 *   dCutoff    (Hz) smoothing of the speed estimate itself
 */
export interface OneEuroParams {
  minCutoff: number;
  beta: number;
  dCutoff: number;
}

const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private lastT = 0;

  constructor(public params: OneEuroParams) {}

  /** Filter value `v` measured at time `t` (ms). */
  filter(v: number, t: number): number {
    // An invalid value would poison the state for good (NaN spreads): skip it, and if the state
    // was already bad, start over from the next good value.
    if (!Number.isFinite(v)) return v;
    if (this.x === null || !Number.isFinite(this.x) || !Number.isFinite(this.dx)) {
      this.dx = 0;
      this.x = v;
      this.lastT = t;
      return v;
    }
    const dt = Math.max(1e-3, (t - this.lastT) / 1000);
    this.lastT = t;
    const { minCutoff, beta, dCutoff } = this.params;
    const rawDx = (v - this.x) / dt;
    this.dx += alpha(dCutoff, dt) * (rawDx - this.dx);
    const cutoff = minCutoff + beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }

  reset() {
    this.x = null;
    this.dx = 0;
  }
}

/** Two independent One Euro filters, for an (x, y) point. */
export class OneEuro2D {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;

  constructor(params: OneEuroParams) {
    this.fx = new OneEuroFilter({ ...params });
    this.fy = new OneEuroFilter({ ...params });
  }

  setParams(params: OneEuroParams) {
    this.fx.params = { ...params };
    this.fy.params = { ...params };
  }

  filter(x: number, y: number, t: number) {
    return { x: this.fx.filter(x, t), y: this.fy.filter(y, t) };
  }

  reset() {
    this.fx.reset();
    this.fy.reset();
  }
}
