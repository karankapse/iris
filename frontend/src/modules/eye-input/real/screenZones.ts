// Turn a gaze point on the screen into a zone: the REST band at the top, or one of the three
// columns below it. Plain geometry: the boxes are where the layout draws them (see LAYOUT).
import { LAYOUT } from '../../../contracts';
import { FeatureSmoother, type Zone } from './corners';

export interface Viewport {
  w: number;
  h: number;
}

/** The plain zone containing (x, y). Points off-screen count as the nearest edge zone. */
export function zoneAt(x: number, y: number, vp: Viewport): Zone {
  if (y < vp.h * LAYOUT.restBottom) return 'center'; // rest: "Partner said" and the face view
  if (x < vp.w * LAYOUT.leftColumn) return 'left';
  if (x > vp.w * LAYOUT.rightColumn) return 'right';
  return 'middle';
}

/** Does `zone`'s box, grown by (mx, my) pixels on every side, contain (x, y)? */
function inside(zone: Zone, x: number, y: number, vp: Viewport, mx: number, my: number): boolean {
  const left = vp.w * LAYOUT.leftColumn;
  const right = vp.w * LAYOUT.rightColumn;
  const rest = vp.h * LAYOUT.restBottom;
  switch (zone) {
    case 'center':
      return y <= rest + my;
    case 'left':
      return y >= rest - my && x <= left + mx;
    case 'right':
      return y >= rest - my && x >= right - mx;
    case 'middle':
      return y >= rest - my && x >= left - mx && x <= right + mx;
  }
}

/**
 * Where the tracker's gaze estimate actually lands for this person when they look at each area,
 * as fractions of the screen (0..1). Measured at the end of calibration. Webcam gaze is usually
 * skewed (e.g. "looking left" may land a third of the way in), so we classify a gaze point by the
 * NEAREST of these measured positions instead of fixed screen thirds.
 */
export type GazeCentroids = Record<Zone, { x: number; y: number }>;

export function nearestZone(
  x: number,
  y: number,
  vp: Viewport,
  c: GazeCentroids,
): { zone: Zone; dist: Record<Zone, number> } {
  const fx = x / vp.w;
  const fy = y / vp.h;
  const dist = {} as Record<Zone, number>;
  let zone: Zone = 'center';
  for (const z of Object.keys(c) as Zone[]) {
    dist[z] = Math.hypot(fx - c[z].x, fy - c[z].y);
    if (dist[z] < (dist[zone] ?? Infinity)) zone = z;
  }
  return { zone, dist };
}

const CENTROIDS_KEY = 'iris.gazeCentroids.v1';

export function loadCentroids(): GazeCentroids | null {
  try {
    const c = JSON.parse(localStorage.getItem(CENTROIDS_KEY) ?? 'null');
    const ok = (p: unknown) =>
      !!p &&
      typeof (p as { x: unknown }).x === 'number' &&
      typeof (p as { y: unknown }).y === 'number';
    return c && ok(c.center) && ok(c.left) && ok(c.middle) && ok(c.right) ? c : null;
  } catch {
    return null;
  }
}

export function saveCentroids(c: GazeCentroids) {
  try {
    localStorage.setItem(CENTROIDS_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

/** A different zone must be this much closer (as a fraction) than the current one to take over. */
const SWITCH_RATIO = 0.8;

/** How far past a box edge the gaze must go before we leave the current zone (fraction of screen). */
const STICKY_X = 0.03;
const STICKY_Y = 0.05;

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
  /** The last smoothed gaze point (fractions of the screen), for learning after a selection. */
  lastPoint: { x: number; y: number } | null = null;
  private centroids: GazeCentroids | null = loadCentroids();

  constructor(
    private holdMs: number,
    private viewport: () => Viewport = () => ({ w: window.innerWidth, h: window.innerHeight }),
  ) {}

  setHoldMs(holdMs: number) {
    this.holdMs = holdMs;
  }

  setCentroids(c: GazeCentroids | null) {
    this.centroids = c;
  }

  /** Nudge a zone's measured position toward where the gaze just was (keeps adapting in use). */
  learn(zone: Zone, rate = 0.15) {
    if (!this.centroids || !this.lastPoint) return;
    const c = this.centroids[zone];
    this.centroids[zone] = {
      x: c.x + rate * (this.lastPoint.x - c.x),
      y: c.y + rate * (this.lastPoint.y - c.y),
    };
    saveCentroids(this.centroids);
  }

  /** `suppress`: eyes are closing/opening, so the gaze numbers are unreliable: keep the last zone. */
  update(t: number, point: { x: number; y: number } | null, suppress: boolean): Zone {
    if (suppress || !point) return this.current;

    const vp = this.viewport();
    const [x, y] = this.smoother.push([point.x, point.y]);
    this.lastPoint = { x: x / vp.w, y: y / vp.h };
    let target: Zone;
    if (this.centroids) {
      // calibrated: nearest measured position, and only switch when clearly closer (no flicker)
      const { zone, dist } = nearestZone(x, y, vp, this.centroids);
      target =
        zone !== this.current && dist[zone] > dist[this.current] * SWITCH_RATIO
          ? this.current
          : zone;
    } else {
      const stillInCurrent = inside(this.current, x, y, vp, STICKY_X * vp.w, STICKY_Y * vp.h);
      target = stillInCurrent ? this.current : zoneAt(x, y, vp);
    }

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
