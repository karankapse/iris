// Ridge regression from a feature vector to a screen point, with honest error estimates:
// leave-one-dot-out cross-validation (train on every calibration dot but one, test on that one)
// both to choose the amount of regularisation and to report how far off the model is on spots it
// was NOT trained on. Used by the face-landmark estimate (landmarkModel.ts) and by our own
// eye-patch model (a better-behaved replacement for WebGazer's built-in regression).
//
// Fast enough for 120 features and ~1000 samples: the per-dot sums (X'X, X'y) are computed once,
// and each held-out fit subtracts one dot's share instead of recomputing everything.

export interface RidgeSample {
  f: number[];
  /** Where the person was looking (px). */
  x: number;
  y: number;
  /** Which calibration dot it came from (samples of one dot are held out together). */
  group: number;
}

export interface RidgeModel {
  mean: number[];
  std: number[];
  /** Weights for [1, standardised features...] */
  wx: number[];
  wy: number[];
  /** Cross-validated error (px): how far off it is on dots it wasn't trained on. */
  errX: number;
  errY: number;
}

export interface RidgeFit {
  model: RidgeModel;
  /** For each input sample: the prediction of a model trained WITHOUT that sample's dot. */
  cv: { x: number; y: number }[];
  lambda: { x: number; y: number };
}

export interface RidgeOptions {
  lambdas: number[];
  minGroups: number;
  minSamples: number;
}

export function fitRidge(samples: RidgeSample[], opts: RidgeOptions): RidgeFit | null {
  const groups = [...new Set(samples.map((s) => s.group))];
  if (groups.length < opts.minGroups || samples.length < opts.minSamples) return null;
  const d = samples[0].f.length;
  if (samples.some((s) => s.f.length !== d)) return null;
  const D = d + 1;

  const mean = new Array<number>(d).fill(0);
  for (const s of samples) for (let j = 0; j < d; j++) mean[j] += s.f[j];
  for (let j = 0; j < d; j++) mean[j] /= samples.length;
  const std = new Array<number>(d).fill(0);
  for (const s of samples) for (let j = 0; j < d; j++) std[j] += (s.f[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / samples.length) || 1e-6;
  const Z = samples.map((s) => standardise(s.f, mean, std));

  // per-group sufficient statistics
  const index = new Map(groups.map((g, i) => [g, i]));
  const G = groups.map(() => zeros(D * D));
  const BX = groups.map(() => zeros(D));
  const BY = groups.map(() => zeros(D));
  samples.forEach((s, k) => {
    const gi = index.get(s.group)!;
    const z = Z[k];
    const g = G[gi];
    for (let i = 0; i < D; i++) {
      const zi = z[i];
      BX[gi][i] += zi * s.x;
      BY[gi][i] += zi * s.y;
      for (let j = 0; j <= i; j++) g[i * D + j] += zi * z[j];
    }
  });
  const total = zeros(D * D);
  const bx = zeros(D);
  const by = zeros(D);
  for (let gi = 0; gi < groups.length; gi++) {
    for (let i = 0; i < D * D; i++) total[i] += G[gi][i];
    for (let i = 0; i < D; i++) {
      bx[i] += BX[gi][i];
      by[i] += BY[gi][i];
    }
  }
  const members = groups.map(() => [] as number[]);
  samples.forEach((s, k) => members[index.get(s.group)!].push(k));

  let best = {
    x: { lambda: opts.lambdas[0], err: Infinity, cv: [] as number[] },
    y: { lambda: opts.lambdas[0], err: Infinity, cv: [] as number[] },
  };
  for (const lambda of opts.lambdas) {
    const cvx = new Array<number>(samples.length).fill(NaN);
    const cvy = new Array<number>(samples.length).fill(NaN);
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let gi = 0; gi < groups.length; gi++) {
      const A = zeros(D * D);
      for (let i = 0; i < D * D; i++) A[i] = total[i] - G[gi][i];
      const rx = bx.map((v, i) => v - BX[gi][i]);
      const ry = by.map((v, i) => v - BY[gi][i]);
      const w = solveRidge(A, D, lambda, [rx, ry]);
      if (!w) continue;
      for (const k of members[gi]) {
        cvx[k] = dot(w[0], Z[k]);
        cvy[k] = dot(w[1], Z[k]);
        sx += (cvx[k] - samples[k].x) ** 2;
        sy += (cvy[k] - samples[k].y) ** 2;
        n++;
      }
    }
    if (!n) continue;
    const ex = Math.sqrt(sx / n);
    const ey = Math.sqrt(sy / n);
    if (ex < best.x.err) best = { ...best, x: { lambda, err: ex, cv: cvx } };
    if (ey < best.y.err) best = { ...best, y: { lambda, err: ey, cv: cvy } };
  }
  if (!Number.isFinite(best.x.err) || !Number.isFinite(best.y.err)) return null;

  const wx = solveRidge(total.slice(), D, best.x.lambda, [bx])?.[0];
  const wy = solveRidge(total.slice(), D, best.y.lambda, [by])?.[0];
  if (!wx || !wy) return null;
  return {
    model: { mean, std, wx, wy, errX: best.x.err, errY: best.y.err },
    cv: samples.map((_, k) => ({ x: best.x.cv[k], y: best.y.cv[k] })),
    lambda: { x: best.x.lambda, y: best.y.lambda },
  };
}

export function predictRidge(model: RidgeModel, f: number[]) {
  const z = standardise(f, model.mean, model.std);
  return { x: dot(model.wx, z), y: dot(model.wy, z) };
}

/** A saved model is usable: all arrays present, the right sizes, finite. */
export function validModel(m: unknown): m is RidgeModel {
  const r = m as RidgeModel | null;
  const finite = (a: unknown, n?: number) =>
    Array.isArray(a) && (n === undefined || a.length === n) && a.every(Number.isFinite);
  return (
    !!r &&
    finite(r.mean) &&
    finite(r.std, r.mean.length) &&
    finite(r.wx, r.mean.length + 1) &&
    finite(r.wy, r.mean.length + 1) &&
    Number.isFinite(r.errX) &&
    Number.isFinite(r.errY)
  );
}

function standardise(f: number[], mean: number[], std: number[]) {
  const z = new Array<number>(f.length + 1);
  z[0] = 1;
  for (let j = 0; j < f.length; j++) z[j + 1] = (f[j] - mean[j]) / std[j];
  return z;
}

/**
 * Solve (A + lambda * I') w = b for each right-hand side, where A is the lower triangle of a
 * symmetric D x D matrix (row-major) and I' leaves the intercept (index 0) unpenalised.
 * Cholesky; null if the system is not positive definite.
 */
function solveRidge(A: number[], D: number, lambda: number, rhs: number[][]): number[][] | null {
  const L = zeros(D * D);
  for (let i = 0; i < D; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i * D + j] + (i === j && i > 0 ? lambda : 0);
      for (let k = 0; k < j; k++) sum -= L[i * D + k] * L[j * D + k];
      if (i === j) {
        if (!(sum > 1e-12)) return null;
        L[i * D + i] = Math.sqrt(sum);
      } else L[i * D + j] = sum / L[j * D + j];
    }
  }
  return rhs.map((b) => {
    const y = zeros(D);
    for (let i = 0; i < D; i++) {
      let s = b[i];
      for (let k = 0; k < i; k++) s -= L[i * D + k] * y[k];
      y[i] = s / L[i * D + i];
    }
    const w = zeros(D);
    for (let i = D - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k < D; k++) s -= L[k * D + i] * w[k];
      w[i] = s / L[i * D + i];
    }
    return w;
  });
}

const zeros = (n: number) => new Array<number>(n).fill(0);
const dot = (w: number[], z: number[]) => {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i] * z[i];
  return s;
};
