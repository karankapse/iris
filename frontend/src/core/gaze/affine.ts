/**
 * A 2D affine correction for gaze predictions, learned from a quick check at the end of
 * calibration: "when you looked at THESE spots, the tracker said THOSE". It fixes systematic
 * errors, most importantly WebGazer's habit of squeezing predictions toward the middle of the
 * screen (its regression shrinks toward the average), which makes the left and right columns hard
 * to reach.
 *   x' = a·x + b·y + c
 *   y' = d·x + e·y + f
 */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };

export function applyAffine(m: Affine, x: number, y: number) {
  return { x: m.a * x + m.b * y + m.c, y: m.d * x + m.e * y + m.f };
}

export interface PointPair {
  /** predicted (px) */
  px: number;
  py: number;
  /** true target (px) */
  tx: number;
  ty: number;
}

/** A correction that stretches (or shrinks) more than this is not believed. */
const MAX_SCALE = 4;
const MIN_SCALE = 0.4;
/** ...nor one that moves the screen centre off the screen by more than this share. */
const MAX_CENTRE_OFFSET = 0.25;

/**
 * Least-squares fit of predicted -> true. Works on centred screen fractions, and pulls the slopes
 * very slightly toward "no correction" (`lambda`) only so a degenerate set of points can't blow
 * up; the offset is not pulled at all, so a real squeeze or shift is fully corrected.
 * Returns null with fewer than 4 points or an implausible result.
 */
export function fitAffine(
  pairs: PointPair[],
  vp: { w: number; h: number },
  lambda = 0.002,
): Affine | null {
  if (pairs.length < 4) return null;
  const u = pairs.map((p) => p.px / vp.w);
  const v = pairs.map((p) => p.py / vp.h);
  const mu = mean(u);
  const mv = mean(v);
  const cu = u.map((x) => x - mu);
  const cv = v.map((x) => x - mv);
  const suu = dot(cu, cu);
  const svv = dot(cv, cv);
  const suv = dot(cu, cv);

  /** Slopes (for u, v) + intercept for one output axis, in screen fractions. */
  const fitAxis = (targets: number[], prior: [number, number]) => {
    const mt = mean(targets);
    const ct = targets.map((x) => x - mt);
    const slopes = solve(
      [
        [suu + lambda, suv],
        [suv, svv + lambda],
      ],
      [dot(cu, ct) + lambda * prior[0], dot(cv, ct) + lambda * prior[1]],
    );
    return slopes ? [slopes[0], slopes[1], mt - slopes[0] * mu - slopes[1] * mv] : null;
  };
  const ux = fitAxis(
    pairs.map((p) => p.tx / vp.w),
    [1, 0],
  );
  const uy = fitAxis(
    pairs.map((p) => p.ty / vp.h),
    [0, 1],
  );
  if (!ux || !uy) return null;
  const centre = { x: ux[0] * 0.5 + ux[1] * 0.5 + ux[2], y: uy[0] * 0.5 + uy[1] * 0.5 + uy[2] };
  const scaleOk = (s: number) => s >= MIN_SCALE && s <= MAX_SCALE;
  const centreOk = (c: number) => c >= -MAX_CENTRE_OFFSET && c <= 1 + MAX_CENTRE_OFFSET;
  if (!scaleOk(ux[0]) || !scaleOk(uy[1]) || !centreOk(centre.x) || !centreOk(centre.y)) return null;
  // back from screen fractions to pixels
  return {
    a: ux[0],
    b: (ux[1] * vp.w) / vp.h,
    c: ux[2] * vp.w,
    d: (uy[0] * vp.h) / vp.w,
    e: uy[1],
    f: uy[2] * vp.h,
  };
}

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

/** Solve A·x = b (small, well-conditioned systems) by Gaussian elimination with pivoting. */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const k = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= k * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
