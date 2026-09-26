// Turn a gaze point on the screen into a zone: one of the four corner boxes, or the middle
// column (rest). Plain geometry: the boxes are where the layout draws them (see LAYOUT).
import { LAYOUT } from '../../../contracts';
import { FeatureSmoother, type Zone } from './corners';

export interface Viewport {
  w: number;
  h: number;
}

/** The plain zone containing (x, y). Points off-screen count as the nearest edge zone. */
export function zoneAt(x: number, y: number, vp: Viewport): Zone {
  const col =
    x < vp.w * LAYOUT.leftColumn ? 'left' : x > vp.w * LAYOUT.rightColumn ? 'right' : 'middle';
  if (col === 'middle') return 'center';
  const top = y < vp.h * LAYOUT.middleRow;
  if (col === 'left') return top ? 'up-left' : 'down-left';
  return top ? 'up-right' : 'down-right';
}

/** Does `zone`'s box, grown by (mx, my) pixels on every side, contain (x, y)? */
function inside(zone: Zone, x: number, y: number, vp: Viewport, mx: number, my: number): boolean {
  const left = vp.w * LAYOUT.leftColumn;
  const right = vp.w * LAYOUT.rightColumn;
  const mid = vp.h * LAYOUT.middleRow;
  switch (zone) {
    case 'center':
      return x >= left - mx && x <= right + mx;
    case 'up-left':
      return x <= left + mx && y <= mid + my;
    case 'up-right':
      return x >= right - mx && y <= mid + my;
    case 'down-left':
      return x <= left + mx && y >= mid - my;
    case 'down-right':
      return x >= right - mx && y >= mid - my;
  }
}

/** How far past a box edge the gaze must go before we leave the current zone (fraction of screen). */
const STICKY_X = 0.03;
const STICKY_Y = 0.04;

/**
 * Stable "current zone" from noisy screen gaze:
 *  - smoothing (median + moving average) removes jitter,
 *  - sticky edges: you stay in your current zone until you are clearly outside it,
 *  - a hold time: a new zone must be the answer for a moment before it counts.
 */
export class ScreenZoneTracker {
  current: Zone = 'center';
  private candidate: Zone = 'center';
  private candidateSince = 0;
  private smoother = new FeatureSmoother();

  constructor(
    private holdMs: number,
    private viewport: () => Viewport = () => ({ w: window.innerWidth, h: window.innerHeight }),
  ) {}

  setHoldMs(holdMs: number) {
    this.holdMs = holdMs;
  }

  /** `suppress`: eyes are closing/opening, so the gaze numbers are unreliable: keep the last zone. */
  update(t: number, point: { x: number; y: number } | null, suppress: boolean): Zone {
    if (suppress || !point) return this.current;

    const vp = this.viewport();
    const [x, y] = this.smoother.push([point.x, point.y]);
    const stillInCurrent = inside(this.current, x, y, vp, STICKY_X * vp.w, STICKY_Y * vp.h);
    const target = stillInCurrent ? this.current : zoneAt(x, y, vp);

    if (target !== this.candidate) {
      this.candidate = target;
      this.candidateSince = t;
    }
    if (this.candidate !== this.current && t - this.candidateSince >= this.holdMs) {
      this.current = this.candidate;
    }
    return this.current;
  }

  reset() {
    this.current = 'center';
    this.candidate = 'center';
    this.smoother.reset();
  }
}
