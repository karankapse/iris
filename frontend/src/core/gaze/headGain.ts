// How much does turning / nodding the head move the gaze estimate, while the eyes stay on the same
// spot? Learned from data instead of guessed: for moments where we KNOW where the person looked
// (calibration dots), regress the estimate's error on the head's rotation away from the
// calibration pose. FilteredGaze then subtracts that (x -= gainX * yaw, y += gainY * pitch).
//
// Only movement WITHIN each dot is used (every dot's own average is removed first): people tend to
// turn their head a little toward where they look, which would otherwise mix up "the head turned"
// with "the gaze moved". The estimate is shrunk toward 0 and only trusted when clearly different
// from 0; otherwise compensation stays off (a wrong sign doubles the error instead of removing it).

export interface HeadPoint {
  /** Target minus estimate (px). */
  residX: number;
  residY: number;
  /** Head rotation away from the calibration pose (degrees). */
  yaw: number;
  pitch: number;
  group: number;
}

export interface HeadGain {
  /** In FilteredGaze's convention: x -= gainX * yaw, y += gainY * pitch. 0 = off. */
  gainX: number;
  gainY: number;
  /** Standard errors of the slopes (px/deg), for the report. */
  seX: number;
  seY: number;
  /** Spread of the head rotation that was seen (degrees, within dots). */
  yawSpread: number;
  pitchSpread: number;
}

export interface HeadGainOptions {
  /** Shrinkage toward 0, in "degrees^2 of evidence" (like adding this many samples at 1 degree). */
  prior: number;
  /** Less head movement than this (degrees, SD within dots) = no evidence at all. */
  minSpread: number;
  /** Consecutive samples are not independent (the head moves slowly): inflate the SE by this. */
  seInflation: number;
  /** Largest gain believed (px/deg). */
  maxGain: number;
}

export const HEAD_GAIN_DEFAULTS: HeadGainOptions = {
  prior: 20,
  minSpread: 1,
  seInflation: 3,
  maxGain: 80,
};

export function estimateHeadGain(
  points: HeadPoint[],
  opts: HeadGainOptions = HEAD_GAIN_DEFAULTS,
): HeadGain {
  const groups = new Map<number, HeadPoint[]>();
  for (const p of points) {
    if (![p.residX, p.residY, p.yaw, p.pitch].every(Number.isFinite)) continue;
    (groups.get(p.group) ?? groups.set(p.group, []).get(p.group)!).push(p);
  }
  // centre everything within each dot
  const c: { rx: number; ry: number; yaw: number; pitch: number }[] = [];
  for (const ps of groups.values()) {
    if (ps.length < 3) continue;
    const m = (k: keyof HeadPoint) => ps.reduce((s, p) => s + p[k], 0) / ps.length;
    const [mrx, mry, myaw, mpitch] = [m('residX'), m('residY'), m('yaw'), m('pitch')];
    for (const p of ps)
      c.push({
        rx: p.residX - mrx,
        ry: p.residY - mry,
        yaw: p.yaw - myaw,
        pitch: p.pitch - mpitch,
      });
  }
  const slope = (r: number[], d: number[]) => {
    const sdd = d.reduce((s, v) => s + v * v, 0);
    const spread = Math.sqrt(sdd / (d.length || 1));
    if (d.length < 10 || spread < opts.minSpread) return { g: 0, se: Infinity, spread };
    const b = r.reduce((s, v, i) => s + v * d[i], 0) / (sdd + opts.prior);
    const res = r.reduce((s, v, i) => s + (v - b * d[i]) ** 2, 0) / Math.max(1, d.length - 1);
    const se = opts.seInflation * Math.sqrt(res / sdd);
    // only trust a clearly non-zero, believable slope
    const g = Math.abs(b) > 2 * se && Math.abs(b) <= opts.maxGain ? b : 0;
    return { g, se, spread };
  };
  const sx = slope(
    c.map((p) => p.rx),
    c.map((p) => p.yaw),
  );
  const sy = slope(
    c.map((p) => p.ry),
    c.map((p) => p.pitch),
  );
  // target - estimate = -gainX * yaw  (x -= gainX * yaw fixes it)
  // target - estimate = +gainY * pitch (y += gainY * pitch fixes it)
  return {
    gainX: sx.g === 0 ? 0 : -sx.g,
    gainY: sy.g,
    seX: sx.se,
    seY: sy.se,
    yawSpread: sx.spread,
    pitchSpread: sy.spread,
  };
}
