import type { FaceFrame, GazePoint, ScreenGaze } from '../../contracts';
import { createEmitter } from '../emitter';
import { IDENTITY, applyAffine, type Affine } from './affine';
import { fitLandmarkRidge, landmarkFeatures, useless, type LandmarkModel } from './landmarkModel';
import { OneEuro2D } from './oneEuro';
import {
  fitRidge,
  predictRidge,
  validModel,
  type RidgeFit,
  type RidgeModel,
  type RidgeSample,
} from './ridge';

/**
 * Wraps any ScreenGaze (WebGazer, mouse) and cleans up its points before the rest of the app
 * sees them:
 *   0. our own eye-patch model: when the tracker also hands us its per-frame eye-patch features
 *      (WebGazer does), we learn the mapping to the screen ourselves (ridge regression with
 *      leave-one-dot-out cross-validation, see ridge.ts) instead of trusting its built-in one;
 *   1. correction: an affine fix learned in calibration's check round (stretches WebGazer's
 *      squeezed-toward-the-middle predictions back out to the screen edges);
 *   2. fusion: a second estimate from the face landmarks (iris position, see landmarkModel.ts)
 *      is blended in, per axis, weighted by how accurate each one measured for this person;
 *   3. head-pose compensation: turning or nodding the head while looking at the same spot moves
 *      the eyes inside the head, which the trackers read as a gaze change. We undo that using the
 *      head's yaw/pitch relative to the pose during calibration;
 *   4. a One Euro filter: steady when the eyes are still, no lag when they jump.
 * It is still a ScreenGaze, so nothing else has to change. The debug overlay listens to
 * onSample() to see every stage.
 */
export interface GazeFilterParams {
  /** One Euro filter (see oneEuro.ts). */
  minCutoff: number;
  beta: number;
  dCutoff: number;
  /** Pixels to shift per degree of head turn (yaw) / nod (pitch) away from the calibration pose. 0 = off. */
  headGainX: number;
  headGainY: number;
  /** 1 = blend in the face-landmark gaze estimate (once calibrated), 0 = tracker only. */
  landmarkFusion: number;
  /** 1 = use our own regression on the tracker's eye-patch features (once calibrated), 0 = the tracker's own. */
  patchModel: number;
  /** 1 = ignore tracker points while the eyes are closed (it reads the eyelid and jumps away). */
  skipBlinks: number;
  /** Learning during use: share of the remaining error corrected per confirmed selection (0 = off). */
  driftRate: number;
}

export const DEFAULT_GAZE_FILTER: GazeFilterParams = {
  minCutoff: 0.5,
  beta: 0.007,
  dCutoff: 1,
  headGainX: 20,
  headGainY: 20,
  landmarkFusion: 1,
  patchModel: 1,
  skipBlinks: 1,
  driftRate: 0.3,
};

export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
}

/** What calibration learned about combining and correcting the two estimates. */
export interface GazeCalibration {
  webgazerFix: Affine;
  landmarkFix: Affine;
  /** Share given to the tracker (WebGazer) on each axis; the rest goes to the landmark estimate. */
  weights: { x: number; y: number };
  landmark: LandmarkModel | null;
  /** Our own model from the tracker's eye-patch features to the screen (null = use the tracker's). */
  tracker?: RidgeModel | null;
}

const EMPTY_CALIBRATION: GazeCalibration = {
  webgazerFix: IDENTITY,
  landmarkFix: IDENTITY,
  weights: { x: 1, y: 1 },
  landmark: null,
  tracker: null,
};

/**
 * A tracker that can also hand over the features it predicts from, for the latest frame (e.g.
 * WebGazer's 120 eye-patch pixel values). Optional: FilteredGaze works without it.
 */
export interface EyeFeatureSource {
  eyeFeatures(): { f: number[]; t: number } | null;
}

function featureSource(g: ScreenGaze): EyeFeatureSource | null {
  return typeof (g as Partial<EyeFeatureSource>).eyeFeatures === 'function'
    ? (g as unknown as EyeFeatureSource)
    : null;
}

/** One moment of calibration (or of confirmed use): where the person looked, and what we saw. */
export interface CalSample {
  x: number;
  y: number;
  /** Which dot (samples of one dot are held out together in cross-validation). */
  group: number;
  kind: 'train' | 'check' | 'online' | 'head';
  /** Calibration round (the check round can be repeated). */
  round: number;
  t: number;
  /** Face-landmark features (null: eyes closed or no face frame). */
  lf: number[] | null;
  /** The tracker's eye-patch features (null: the tracker doesn't provide them). */
  tf: number[] | null;
  /** The tracker's own estimate at that moment. */
  native: { x: number; y: number } | null;
  head: { yaw: number; pitch: number } | null;
  /** Predictions for this sample by models trained WITHOUT its dot (set by fitModels()). */
  cvLandmark?: { x: number; y: number } | null;
  cvTracker?: { x: number; y: number } | null;
}

/** Ridge settings for the eye-patch model (standardised features, so these are relative). */
const PATCH_RIDGE = {
  lambdas: [0.3, 3, 30, 300, 3000, 30000],
  minGroups: 6,
  minSamples: 40,
};
/** Most samples kept (oldest "online" ones go first). */
const MAX_SAMPLES = 2500;
/** The drift offset never exceeds this share of the screen. */
const MAX_DRIFT = 0.15;
/** How much recent history is kept for learning from confirmed use (ms). */
const RECENT_MS = 4000;
/** Group numbers of samples learned during use. */
const ONLINE_GROUP = 1000;

/** One frame of recent history. */
export interface RecentFrame {
  t: number;
  lf: number[] | null;
  tf: number[] | null;
  native: { x: number; y: number } | null;
  head: { yaw: number; pitch: number } | null;
  /** Where the dot was drawn (final, smoothed estimate). */
  filtered: { x: number; y: number };
}

export interface GazeSample {
  /** The tracker estimate used: our eye-patch model's, else straight from the tracker (WebGazer). */
  raw: GazePoint;
  /** The landmark model's own estimate (uncorrected), when it has one. */
  landmark: { x: number; y: number } | null;
  /** After correction + fusion, before head compensation. */
  fused: { x: number; y: number };
  /** The tracker's own estimate (differs from `raw` when our eye-patch model is used). */
  native: GazePoint | null;
  /** After head-pose compensation, before smoothing. */
  compensated: { x: number; y: number };
  filtered: GazePoint;
  /** Head pose relative to the calibration pose (degrees), or null if unknown. */
  headDelta: { yaw: number; pitch: number } | null;
}

/** Head pose older than this is stale (face lost): skip compensation rather than use it. */
const HEAD_STALE_MS = 500;
/** Tracker points this soon after the eyes re-open are skipped too (the eyes settle back). */
const BLINK_GUARD_MS = 100;
/** A landmark estimate is only blended with a tracker point from (about) the same moment. */
const LANDMARK_STALE_MS = 150;
const PARAMS_KEY = 'iris.gazeFilter.v1';
const BASELINE_KEY = 'iris.gazeHeadBaseline.v1';
const CALIBRATION_KEY = 'iris.gazeCalibration.v1';

/** Eyes open enough for the landmarks to mean something (MediaPipe's blink scores). */
export function eyesOpen(frame: FaceFrame): boolean {
  const b = frame.blendshapes;
  return ((b.eyeBlinkLeft ?? 0) + (b.eyeBlinkRight ?? 0)) / 2 < 0.4;
}

/**
 * Correct each estimate, then blend them per axis. Pure, so calibration can score exactly what
 * the app will use.
 */
export function fusePoint(
  cal: GazeCalibration,
  tracker: { x: number; y: number },
  landmark: { x: number; y: number } | null,
) {
  const t = applyAffine(cal.webgazerFix, tracker.x, tracker.y);
  if (!landmark || !cal.landmark) return t;
  const l = applyAffine(cal.landmarkFix, landmark.x, landmark.y);
  return {
    x: cal.weights.x * t.x + (1 - cal.weights.x) * l.x,
    y: cal.weights.y * t.y + (1 - cal.weights.y) * l.y,
  };
}

export class FilteredGaze implements ScreenGaze {
  private out = createEmitter<GazePoint | null>();
  private sampleEmitter = createEmitter<GazeSample>();
  private params: GazeFilterParams = loadParams();
  private filter = new OneEuro2D(this.params);
  private head: HeadPose | null = null;
  private headAt = -Infinity;
  /** Average head pose while the tracker was being trained (= "looking straight" for it). */
  private baseline: { yaw: number; pitch: number } | null = loadBaseline();
  private training = { yaw: 0, pitch: 0, n: 0 };
  private cal: GazeCalibration = loadCalibration();
  private latestFrame: FaceFrame | null = null;
  private lastLandmark: { x: number; y: number; t: number } | null = null;
  private lastNative: GazePoint | null = null;
  private closedAt = -Infinity;
  private calSamples: CalSample[] = [];
  private group = 0;
  private round = 0;
  private off: (() => void) | null = null;
  private readonly features: EyeFeatureSource | null;

  constructor(readonly inner: ScreenGaze) {
    this.features = featureSource(inner);
  }

  async start() {
    this.off ??= this.inner.onGaze((p) => this.handle(p));
    await this.inner.start();
  }

  stop() {
    this.inner.stop();
    this.off?.();
    this.off = null;
    this.filter.reset();
  }

  onGaze(handler: (point: GazePoint | null) => void) {
    return this.out.on(handler);
  }

  /** Every stage of every point, for the debug overlay and calibration's check round. */
  onSample(handler: (sample: GazeSample) => void) {
    return this.sampleEmitter.on(handler);
  }

  /** Calibration: the following train() / observe() calls belong to dot `group` (in `round`). */
  markPoint(group: number, round = this.round) {
    this.group = group;
    this.round = round;
  }

  /** The person is looking at (x, y) now: teach the tracker, and keep the sample for our models. */
  train(x: number, y: number) {
    this.inner.train(x, y);
    const frame = this.freshFrame();
    if (frame) {
      this.training.yaw += frame.headPose.yaw;
      this.training.pitch += frame.headPose.pitch;
      this.training.n++;
      this.baseline = {
        yaw: this.training.yaw / this.training.n,
        pitch: this.training.pitch / this.training.n,
      };
      if (this.training.n % 10 === 1) save(BASELINE_KEY, this.baseline);
    }
    this.record(x, y, 'train');
  }

  /**
   * The person is looking at (x, y) now, but DON'T teach the tracker: just keep the sample (the
   * check round measures first; its samples join our models' training afterwards).
   * Returns true if the sample has a tracker estimate (features or the tracker's own point).
   */
  observe(x: number, y: number, kind: CalSample['kind'] = 'check'): boolean {
    const s = this.record(x, y, kind);
    return !!s && (!!s.tf || !!s.native);
  }

  private freshFrame(): FaceFrame | null {
    const frame = this.latestFrame;
    return frame && performance.now() - frame.t <= HEAD_STALE_MS ? frame : null;
  }

  private record(x: number, y: number, kind: CalSample['kind']): CalSample | null {
    const now = performance.now();
    const frame = this.freshFrame();
    const feat = this.features?.eyeFeatures() ?? null;
    const native =
      this.lastNative && now - this.lastNative.t <= LANDMARK_STALE_MS ? this.lastNative : null;
    const sample: CalSample = {
      x,
      y,
      group: this.group,
      kind,
      round: this.round,
      t: now,
      lf: frame && eyesOpen(frame) ? landmarkFeatures(frame) : null,
      tf: feat && now - feat.t <= LANDMARK_STALE_MS ? [...feat.f] : null,
      native: native ? { x: native.x, y: native.y } : null,
      head: frame ? { yaw: frame.headPose.yaw, pitch: frame.headPose.pitch } : null,
    };
    if (!sample.lf && !sample.tf && !sample.native) return null;
    this.calSamples.push(sample);
    if (this.calSamples.length > MAX_SAMPLES) {
      const i = this.calSamples.findIndex((s) => s.kind === 'online');
      this.calSamples.splice(i === -1 ? 0 : i, 1);
    }
    return sample;
  }

  /** The average head pose while training (what head compensation is relative to). */
  headBaseline(): { yaw: number; pitch: number } | null {
    return this.baseline ? { ...this.baseline } : null;
  }

  /** The last few seconds of what we saw, frame by frame (for learning from confirmed use). */
  private recentFrames: RecentFrame[] = [];

  private remember(t: number, native: GazePoint | null, filtered: { x: number; y: number }) {
    const frame = this.freshFrame();
    const feat = this.features?.eyeFeatures();
    this.recentFrames.push({
      t,
      lf: frame && eyesOpen(frame) ? landmarkFeatures(frame) : null,
      tf: feat && Math.abs(feat.t - t) <= LANDMARK_STALE_MS ? [...feat.f] : null,
      native: native ? { x: native.x, y: native.y } : null,
      head: frame ? { yaw: frame.headPose.yaw, pitch: frame.headPose.pitch } : null,
      filtered,
    });
    while (this.recentFrames.length && t - this.recentFrames[0].t > RECENT_MS)
      this.recentFrames.shift();
  }

  /** What we saw between t0 and t1 (at most the last few seconds are kept). */
  recall(t0: number, t1: number): RecentFrame[] {
    return this.recentFrames.filter((r) => r.t >= t0 && r.t <= t1);
  }

  /**
   * Learn from confirmed use: during `frames` the person was looking at (x, y). They become
   * samples of a new group, and the models are re-fitted (the corrections are kept).
   * Returns how many samples were added.
   */
  learnFrom(
    frames: RecentFrame[],
    x: number,
    y: number,
    opts: { maxOnline: number; refit: boolean },
  ): number {
    const group = ONLINE_GROUP + this.onlineGroups++;
    let added = 0;
    if (opts.refit) {
      for (const r of frames) {
        if (!r.lf && !r.tf && !r.native) continue;
        this.calSamples.push({
          x,
          y,
          group,
          kind: 'online',
          round: this.round,
          t: r.t,
          lf: r.lf,
          tf: r.tf,
          native: r.native,
          head: r.head,
        });
        added++;
      }
      // keep at most `maxOnline` online samples (the oldest go first), and the overall cap
      let online = this.calSamples.filter((s) => s.kind === 'online').length;
      while (online > opts.maxOnline || this.calSamples.length > MAX_SAMPLES) {
        const i = this.calSamples.findIndex((s) => s.kind === 'online');
        if (i === -1) break;
        this.calSamples.splice(i, 1);
        online--;
      }
      if (added)
        this.fitModels({ exclude: ['head', ...(this.excludeCheck ? ['check' as const] : [])] });
    }
    // Drift correction: nudge a small offset so these moments land on the target (with the
    // models as they are now, i.e. after the re-fit).
    const rate = this.params.driftRate;
    if (rate > 0) {
      const est = frames.map((r) => this.estimateFrame(r)).filter((p) => !!p);
      if (est.length >= 3) {
        const mx = est.reduce((sum, p) => sum + p.x, 0) / est.length;
        const my = est.reduce((sum, p) => sum + p.y, 0) / est.length;
        const w = typeof window === 'undefined' ? 1920 : window.innerWidth;
        const h = typeof window === 'undefined' ? 1080 : window.innerHeight;
        const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
        this.drift = {
          x: clamp(this.drift.x + rate * (x - mx), MAX_DRIFT * w),
          y: clamp(this.drift.y + rate * (y - my), MAX_DRIFT * h),
        };
        added = Math.max(added, 1);
      }
    }
    return added;
  }

  /** The current offset learned from confirmed use (px). */
  driftOffset() {
    return { ...this.drift };
  }

  /** What the pipeline (before smoothing) would say now for a remembered frame. */
  private estimateFrame(r: RecentFrame): { x: number; y: number } | null {
    const model = this.cal.tracker;
    const tracker =
      model && this.params.patchModel && r.tf && r.tf.length === model.mean.length
        ? predictRidge(model, r.tf)
        : r.native;
    if (!tracker) return null;
    const lm = this.cal.landmark && r.lf ? predictRidge(this.cal.landmark, r.lf) : null;
    const p = fusePoint(
      this.cal,
      tracker,
      this.params.landmarkFusion && lm && plausible(lm) ? lm : null,
    );
    let { x, y } = p;
    if (r.head && this.baseline) {
      x -= this.params.headGainX * (r.head.yaw - this.baseline.yaw);
      y += this.params.headGainY * (r.head.pitch - this.baseline.pitch);
    }
    return { x: x + this.drift.x, y: y + this.drift.y };
  }

  /** Whether calibration kept the check dots out of training (online re-fits do the same). */
  excludeCheck = false;
  private onlineGroups = 0;
  /** Offset learned from confirmed use (px), added after head compensation. */
  private drift = { x: 0, y: 0 };

  /** Everything collected so far (calibration dots, check dots, confirmed use). */
  samples(): readonly CalSample[] {
    return this.calSamples;
  }

  /** Forget everything learned: tracker training, landmark model, corrections. */
  async clearTraining() {
    await this.inner.clearTraining();
    this.training = { yaw: 0, pitch: 0, n: 0 };
    this.baseline = null;
    this.calSamples = [];
    this.recentFrames = [];
    this.onlineGroups = 0;
    this.drift = { x: 0, y: 0 };
    this.group = 0;
    this.round = 0;
    this.cal = { ...EMPTY_CALIBRATION };
    this.lastLandmark = null;
    save(CALIBRATION_KEY, this.cal);
    this.filter.reset();
  }

  /**
   * Learn both models from every sample so far: the face-landmark model and (if the tracker gives
   * us its features) our eye-patch model. Each sample also gets its held-out predictions.
   */
  fitModels(opts: { exclude?: CalSample['kind'][] } = {}): {
    landmark: RidgeFit | null;
    tracker: RidgeFit | null;
  } {
    const used = (s: CalSample) => !opts.exclude?.includes(s.kind);
    const fitOne = (
      pick: (s: CalSample) => number[] | null,
      fit: (xs: RidgeSample[]) => RidgeFit | null,
      store: (s: CalSample, p: { x: number; y: number } | null) => void,
    ) => {
      const train = this.calSamples.filter((s) => pick(s) && used(s));
      const data = train.map((s) => ({ f: pick(s)!, x: s.x, y: s.y, group: s.group }));
      const result = data.length ? fit(data) : null;
      train.forEach((s, k) => store(s, result ? result.cv[k] : null));
      // samples left out of the training are predicted by the final model (also held out)
      for (const s of this.calSamples)
        if (pick(s) && !used(s)) store(s, result ? predictRidge(result.model, pick(s)!) : null);
      return result;
    };
    const landmark = fitOne(
      (s) => s.lf,
      fitLandmarkRidge,
      (s, p) => (s.cvLandmark = p),
    );
    const tracker = fitOne(
      (s) => s.tf,
      (xs) => {
        const fit = fitRidge(xs, PATCH_RIDGE);
        return fit && !useless(fit, xs) ? fit : null;
      },
      (s, p) => (s.cvTracker = p),
    );
    this.cal = { ...this.cal, landmark: landmark?.model ?? null, tracker: tracker?.model ?? null };
    save(CALIBRATION_KEY, this.cal);
    return { landmark, tracker };
  }

  /** What the current models say for a stored sample. */
  predictSample(s: CalSample) {
    const { landmark, tracker } = this.cal;
    return {
      landmark: landmark && s.lf ? predictRidge(landmark, s.lf) : null,
      tracker: tracker && s.tf ? predictRidge(tracker, s.tf) : null,
    };
  }

  /** After the training dots: learn the landmark model (and the eye-patch model). */
  fitLandmarks(): LandmarkModel | null {
    return this.fitModels().landmark?.model ?? null;
  }

  /** Is our own eye-patch model in use (rather than the tracker's built-in one)? */
  usesPatchModel(): boolean {
    return !!this.cal.tracker && !!this.params.patchModel;
  }

  /** After the check round: corrections and fusion weights. */
  setCorrection(fix: Pick<GazeCalibration, 'webgazerFix' | 'landmarkFix' | 'weights'>) {
    this.cal = { ...this.cal, ...fix };
    save(CALIBRATION_KEY, this.cal);
    this.filter.reset();
  }

  calibration(): GazeCalibration {
    return this.cal;
  }

  /** Feed every face-tracker frame here (head pose, and the landmark gaze estimate). */
  onFaceFrame(frame: FaceFrame) {
    this.latestFrame = frame;
    if (!eyesOpen(frame)) this.closedAt = frame.t;
    this.head = frame.headPose;
    this.headAt = frame.t;
    const f = this.cal.landmark && eyesOpen(frame) ? landmarkFeatures(frame) : null;
    this.lastLandmark = f ? { ...predictRidge(this.cal.landmark!, f), t: frame.t } : null;
  }

  getParams(): GazeFilterParams {
    return { ...this.params };
  }

  setParams(partial: Partial<GazeFilterParams>) {
    this.params = { ...this.params, ...partial };
    this.filter.setParams(this.params);
    save(PARAMS_KEY, this.params);
  }

  /** Were the eyes closed at time t, or re-opened less than BLINK_GUARD_MS before? */
  private blinking(t: number): boolean {
    const f = this.latestFrame;
    if (!f || Math.abs(t - f.t) > HEAD_STALE_MS) return false; // no face frames: can't tell
    return t - this.closedAt < BLINK_GUARD_MS;
  }

  /** Our eye-patch model's estimate for this frame, if it has one (null = use the tracker's). */
  private patchEstimate(native: GazePoint | null): GazePoint | null {
    const model = this.cal.tracker;
    if (!model || !this.params.patchModel || !this.features) return null;
    const feat = this.features.eyeFeatures();
    if (!feat || feat.f.length !== model.mean.length) return null;
    if (native && Math.abs(native.t - feat.t) > LANDMARK_STALE_MS) return null;
    const e = predictRidge(model, feat.f);
    return plausible(e) ? { ...e, t: native?.t ?? feat.t } : null;
  }

  private handle(native: GazePoint | null) {
    // A tracker with little or no training can report NaN/Infinity: treat it as "no reading"
    // instead of letting it into the filter (where it would freeze the dot).
    if (native && (!Number.isFinite(native.x) || !Number.isFinite(native.y))) native = null;
    this.lastNative = native;
    // Eyes closed (or just re-opening): the tracker reads the eyelid, not the gaze, and jumps
    // far away. Skip these points: the dot and the dwell simply wait for the eyes to open.
    if (this.params.skipBlinks && this.blinking(native?.t ?? performance.now())) return;
    const p = this.patchEstimate(native) ?? native;
    if (!p) {
      this.filter.reset(); // face lost: don't glide in from a stale position when it comes back
      this.out.emit(null);
      return;
    }
    const lm = this.lastLandmark;
    const landmark =
      lm && Math.abs(p.t - lm.t) <= LANDMARK_STALE_MS && plausible(lm)
        ? { x: lm.x, y: lm.y }
        : null;
    const fused = fusePoint(this.cal, p, this.params.landmarkFusion ? landmark : null);

    let headDelta: GazeSample['headDelta'] = null;
    let { x, y } = fused;
    if (this.head && this.baseline && p.t - this.headAt < HEAD_STALE_MS) {
      headDelta = {
        yaw: this.head.yaw - this.baseline.yaw,
        pitch: this.head.pitch - this.baseline.pitch,
      };
      // Head turned toward the user's left (yaw +) while fixating: the eyes rotate right inside
      // the head and the trackers overshoot to the right, so pull x back. Same idea for pitch
      // (pitch - = chin up). If the dot moves the WRONG way when you turn your head, make the
      // gain negative in the tuning panel.
      x -= this.params.headGainX * headDelta.yaw;
      y += this.params.headGainY * headDelta.pitch;
    }
    x += this.drift.x;
    y += this.drift.y;
    const f = this.filter.filter(x, y, p.t);
    const filtered = { x: f.x, y: f.y, t: p.t };
    this.remember(p.t, native, filtered);
    this.sampleEmitter.emit({
      raw: p,
      native,
      landmark,
      fused,
      compensated: { x, y },
      filtered,
      headDelta,
    });
    this.out.emit(filtered);
  }
}

/** Off-screen by more than this share of the screen = the estimate is broken, not the gaze. */
const MAX_OFFSCREEN = 0.25;

/** Is this a believable screen position (finite, not far off the screen)? */
export function plausible(p: { x: number; y: number }): boolean {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  const w = typeof window === 'undefined' ? 1920 : window.innerWidth;
  const h = typeof window === 'undefined' ? 1080 : window.innerHeight;
  return (
    p.x > -MAX_OFFSCREEN * w &&
    p.x < (1 + MAX_OFFSCREEN) * w &&
    p.y > -MAX_OFFSCREEN * h &&
    p.y < (1 + MAX_OFFSCREEN) * h
  );
}

function loadParams(): GazeFilterParams {
  const saved = load<Partial<GazeFilterParams>>(PARAMS_KEY);
  const params = { ...DEFAULT_GAZE_FILTER };
  for (const k of Object.keys(params) as (keyof GazeFilterParams)[]) {
    const v = saved?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) params[k] = v;
  }
  return params;
}

function loadBaseline() {
  const b = load<{ yaw: number; pitch: number }>(BASELINE_KEY);
  return b && Number.isFinite(b.yaw) && Number.isFinite(b.pitch) ? b : null;
}

function loadCalibration(): GazeCalibration {
  const c = load<GazeCalibration>(CALIBRATION_KEY);
  const ok = (a: Affine | undefined) =>
    !!a && (['a', 'b', 'c', 'd', 'e', 'f'] as const).every((k) => Number.isFinite(a[k]));
  const w = c?.weights;
  if (!c || !ok(c.webgazerFix) || !ok(c.landmarkFix) || !w || ![w.x, w.y].every(Number.isFinite))
    return { ...EMPTY_CALIBRATION };
  return {
    ...c,
    landmark: validModel(c.landmark) ? c.landmark : null,
    tracker: validModel(c.tracker) ? c.tracker : null,
  };
}

function load<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: still works for this session */
  }
}
