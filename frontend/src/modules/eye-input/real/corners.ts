// Which part of the screen is the person looking at? A personal classifier for 5 zones:
// the rest area and the 3 columns.
//
// Why not simple thresholds? Webcam gaze is noisy and every face is different. So instead of
// guessing, calibration asks the person to look at a dot in each zone and we LEARN what each one
// looks like for them, using six signals at once:
//   gazeX, gazeY   MediaPipe's own eye-rotation estimate
//   irisX, irisY   where the iris sits inside the eye (a second, geometric estimate)
//   yaw, pitch     head turn: people naturally turn their head a little toward what they look at
// Signals that separate this person's corners well get a big say; noisy or useless ones get
// (almost) none. That is what makes it more precise than any fixed rule.
import type { FaceFrame, Region } from '../../../contracts';

export type Zone = 'center' | Region;
export const ZONES: Zone[] = ['center', 'left', 'middle', 'right'];

export const FEATURE_COUNT = 6;

/** The six signals for one camera frame, in a fixed order. */
export function gazeFeatures(frame: FaceFrame): number[] {
  return [
    frame.gaze.x,
    frame.gaze.y,
    frame.metrics.irisX ?? 0,
    frame.metrics.irisY ?? 0,
    frame.headPose.yaw,
    frame.headPose.pitch,
  ];
}

export interface CornerModel {
  /** Typical feature values for each zone (the median of that zone's calibration frames). */
  centroids: Record<Zone, number[]>;
  /** Typical frame-to-frame noise of each feature (pooled over all zones). */
  sigma: number[];
  /** 0..1: how much each feature is trusted (its spread between zones vs its noise). */
  weight: number[];
}

// ---- training ------------------------------------------------------------------------------

const MIN_SAMPLES_PER_ZONE = 8;
const MIN_SIGMA = 1e-4;
/** A feature is fully trusted when its zones are at least this many noise-widths apart. */
const FULL_TRUST_SPREAD = 4;
/** Two zones closer than this (in weighted noise units, squared) are "hard to tell apart". */
const WEAK_PAIR_DISTANCE = 4;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface TrainResult {
  model: CornerModel;
  /** Human-readable problems, e.g. "Top-left and top-right were hard to tell apart". */
  warnings: string[];
}

const ZONE_NAME: Record<Zone, string> = {
  center: 'the rest area',
  left: 'the left column',
  middle: 'the middle column',
  right: 'the right column',
};

/** Learn a model from the calibration frames of each zone. Returns null if there is too little data. */
export function trainCornerModel(samples: Record<Zone, number[][]>): TrainResult | null {
  if (ZONES.some((z) => (samples[z]?.length ?? 0) < MIN_SAMPLES_PER_ZONE)) return null;

  const centroids = {} as Record<Zone, number[]>;
  for (const z of ZONES) {
    centroids[z] = Array.from({ length: FEATURE_COUNT }, (_, j) =>
      median(samples[z].map((f) => f[j])),
    );
  }

  // Noise: how far frames scatter around their own zone's centroid, pooled over all zones.
  const sigma: number[] = [];
  const weight: number[] = [];
  for (let j = 0; j < FEATURE_COUNT; j++) {
    let sumSq = 0;
    let n = 0;
    for (const z of ZONES) {
      for (const f of samples[z]) {
        sumSq += (f[j] - centroids[z][j]) ** 2;
        n++;
      }
    }
    const s = Math.max(Math.sqrt(sumSq / n), MIN_SIGMA);
    const values = ZONES.map((z) => centroids[z][j]);
    const spread = Math.max(...values) - Math.min(...values);
    sigma.push(s);
    weight.push(Math.min(1, spread / (FULL_TRUST_SPREAD * s)));
  }

  const model: CornerModel = { centroids, sigma, weight };

  const warnings: string[] = [];
  for (let a = 0; a < ZONES.length; a++) {
    for (let b = a + 1; b < ZONES.length; b++) {
      if (distance(model, centroids[ZONES[a]], ZONES[b]) < WEAK_PAIR_DISTANCE) {
        warnings.push(
          `${cap(ZONE_NAME[ZONES[a]])} and ${ZONE_NAME[ZONES[b]]} were hard to tell apart.`,
        );
      }
    }
  }
  return { model, warnings };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// ---- classification ---------------------------------------------------------------------------

/** Weighted, noise-normalised squared distance from a feature vector to a zone's centroid. */
export function distance(model: CornerModel, features: number[], zone: Zone): number {
  const c = model.centroids[zone];
  let sum = 0;
  for (let j = 0; j < FEATURE_COUNT; j++) {
    const z = (features[j] - c[j]) / model.sigma[j];
    sum += model.weight[j] * z * z;
  }
  return sum;
}

export function classify(
  model: CornerModel,
  features: number[],
): { zone: Zone; distances: Record<Zone, number> } {
  const distances = {} as Record<Zone, number>;
  let best: Zone = 'center';
  for (const z of ZONES) {
    distances[z] = distance(model, features, z);
    if (distances[z] < distances[best]) best = z;
  }
  return { zone: best, distances };
}

/**
 * A rough guess for someone who hasn't calibrated yet: only MediaPipe's gaze estimate, with
 * made-up positions. It works a little; calibrating (a dot in each corner) is far better.
 */
export function defaultCornerModel(): CornerModel {
  const at = (x: number, y: number) => [x, y, 0, 0, 0, 0];
  return {
    centroids: {
      center: at(0, -0.15),
      left: at(-0.3, 0.3),
      middle: at(0, 0.3),
      right: at(0.3, 0.3),
    },
    sigma: [0.12, 0.12, 1, 1, 1, 1],
    weight: [1, 1, 0, 0, 0, 0],
  };
}

// ---- smoothing + stable zone tracking ---------------------------------------------------------

/**
 * Cleans up the noisy signals: a short median (throws away one-frame spikes) followed by an
 * exponential moving average (smooths the rest). Costs about 100 ms of delay.
 */
export class FeatureSmoother {
  private history: number[][] = [];
  private ema: number[] | null = null;

  constructor(
    private window = 5,
    private alpha = 0.4,
  ) {}

  push(features: number[]): number[] {
    this.history.push(features);
    if (this.history.length > this.window) this.history.shift();
    const med = features.map((_, j) => median(this.history.map((f) => f[j])));
    this.ema = this.ema ? this.ema.map((e, j) => e + this.alpha * (med[j] - e)) : med;
    return this.ema;
  }

  reset() {
    this.history = [];
    this.ema = null;
  }
}

/** A different zone must be clearly closer than the current one to take over. */
const SWITCH_RATIO = 0.75;

/**
 * Turns the stream of frames into a stable "current zone": smoothed, hysteresis (a new zone must
 * be clearly better than the current one) and a hold time (it must stay best for a moment).
 */
export class CornerTracker {
  current: Zone = 'center';
  private candidate: Zone = 'center';
  private candidateSince = 0;
  private smoother = new FeatureSmoother();

  constructor(
    private model: CornerModel,
    private holdMs: number,
  ) {}

  setModel(model: CornerModel) {
    this.model = model;
  }

  setHoldMs(holdMs: number) {
    this.holdMs = holdMs;
  }

  /** `suppress`: eyes are closing/opening, so the numbers are garbage. Keep the last zone. */
  update(t: number, features: number[], suppress: boolean): Zone {
    if (suppress) return this.current;

    const smooth = this.smoother.push(features);
    const { zone: best, distances } = classify(this.model, smooth);

    let target = best;
    if (best !== this.current && !(distances[best] <= distances[this.current] * SWITCH_RATIO)) {
      target = this.current; // not clearly better: stay put
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

// ---- saving ---------------------------------------------------------------------------------------

const STORAGE_KEY = 'iris.gazeModel.v2'; // v2: rest area + 3 columns

export function saveCornerModel(model: CornerModel) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
  } catch {
    /* storage blocked: the model just won't persist */
  }
}

export function loadCornerModel(): CornerModel | null {
  try {
    const m = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    const numbers = (a: unknown) =>
      Array.isArray(a) &&
      a.length === FEATURE_COUNT &&
      a.every((v) => typeof v === 'number' && Number.isFinite(v));
    if (
      m &&
      numbers(m.sigma) &&
      numbers(m.weight) &&
      ZONES.every((z) => numbers(m.centroids?.[z]))
    ) {
      return m as CornerModel;
    }
  } catch {
    /* corrupt or blocked */
  }
  return null;
}
