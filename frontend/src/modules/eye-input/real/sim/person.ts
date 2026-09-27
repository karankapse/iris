// A simulated person in front of a laptop webcam, for testing and benchmarking the gaze pipeline
// without a camera. TEST-ONLY: nothing in the app imports this.
//
// What it models (all seeded, so every run is identical):
//  - where the person looks (a screen point), with a reaction delay, fixational jitter and blinks;
//  - the head: slow random wander of yaw / pitch / sideways position (an Ornstein-Uhlenbeck
//    process), which moves the eyes INSIDE the head while the gaze stays on the same spot;
//  - MediaPipe-like face frames: iris position along the eye (eye-in-head angle + noise),
//    eyeLook* blendshapes, EAR and blink scores, a noisy head pose;
//  - WebGazer-like eye-patch features: a small grid of "pixels" darkened where the iris is, plus
//    appearance changes from head pose, slow lighting drift and per-frame noise;
//  - a WebGazer-like tracker that learns a ridge regression from those features exactly the way
//    WebGazer does (no intercept, lambda 1e-5, ring buffer of `nativeMemory` samples), with the
//    occasional NaN reading.
// The numbers are chosen to land in the range reported for webcam trackers (WebGazer: a few
// degrees of error, worse vertically), NOT to favour any particular method.
import type { FaceFrame, GazePoint, ScreenGaze } from '../../../../contracts';
import { createEmitter } from '../../../../core/emitter';

export interface SimConfig {
  seed: number;
  /** Eye-patch feature count (WebGazer uses 120; fewer keeps the simulation fast). */
  featureDim: number;
  /** Head wander: stationary standard deviation (degrees) and time constant (s). */
  headYawSd: number;
  headPitchSd: number;
  headTauS: number;
  /** Sideways head position wander (mm). */
  headShiftSd: number;
  /** Per-frame noise of the iris position (in degrees of eye rotation). */
  irisNoiseDeg: number;
  /** Per-feature noise of the eye patches, relative to the gaze signal in them. */
  patchNoise: number;
  /** How strongly head pose changes the eye patches' appearance (relative to gaze). */
  patchHeadEffect: number;
  /** Lighting / appearance drift of the eye patches: random-walk size per minute (relative). */
  driftPerMin: number;
  /** Mean seconds between natural blinks (0 = never). */
  blinkEveryS: number;
  /** Chance per frame that the tracker reports NaN. */
  nanRate: number;
  /** Training samples the simulated WebGazer keeps (WebGazer's default: 50). */
  nativeMemory: number;
  /** Noise of the reported head pose (degrees). */
  headPoseNoiseDeg: number;
}

export const DEFAULT_SIM: SimConfig = {
  seed: 7,
  featureDim: 40,
  headYawSd: 2,
  headPitchSd: 1.0,
  headTauS: 4,
  headShiftSd: 8,
  irisNoiseDeg: 3,
  patchNoise: 1,
  patchHeadEffect: 0.5,
  driftPerMin: 0.15,
  blinkEveryS: 5,
  nanRate: 0.01,
  nativeMemory: 50,
  headPoseNoiseDeg: 0.7,
};

/** Seeded random numbers: uniform 0..1 and standard normal. */
export class Rng {
  constructor(private s: number) {}
  next() {
    // mulberry32
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  normal() {
    const u = Math.max(1e-12, this.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
}

/** Viewing geometry: a ~30 cm wide laptop screen seen from 60 cm. */
const DIST_MM = 600;
const SCREEN_MM = 300;
const deg = (rad: number) => (rad * 180) / Math.PI;

/** WebGazer's own regression, reproduced: ridge without intercept over raw features. */
export class WindowedRidge {
  private X: number[][] = [];
  private yx: number[] = [];
  private yy: number[] = [];
  private w: { x: number[]; y: number[] } | null = null;
  constructor(
    private memory: number,
    private lambda = 1e-5,
  ) {}
  get size() {
    return this.X.length;
  }
  add(f: number[], x: number, y: number) {
    this.X.push(f);
    this.yx.push(x);
    this.yy.push(y);
    if (this.X.length > this.memory) {
      this.X.shift();
      this.yx.shift();
      this.yy.shift();
    }
    this.w = null; // WebGazer re-solves on every frame; solving once per change gives the same result
  }
  clear() {
    this.X = [];
    this.yx = [];
    this.yy = [];
    this.w = null;
  }
  predict(f: number[]): { x: number; y: number } | null {
    if (!this.X.length) return null;
    if (!this.w) {
      const d = f.length;
      const A = Array.from({ length: d }, () => new Array(d).fill(0));
      const bx = new Array(d).fill(0);
      const by = new Array(d).fill(0);
      this.X.forEach((row, k) => {
        for (let i = 0; i < d; i++) {
          bx[i] += row[i] * this.yx[k];
          by[i] += row[i] * this.yy[k];
          for (let j = 0; j <= i; j++) A[i][j] += row[i] * row[j];
        }
      });
      for (let i = 0; i < d; i++) {
        for (let j = 0; j < i; j++) A[j][i] = A[i][j];
        A[i][i] += this.lambda;
      }
      this.w = { x: gauss(A, bx), y: gauss(A, by) };
    }
    return { x: dotp(this.w.x, f), y: dotp(this.w.y, f) };
  }
}

function gauss(A0: number[][], b0: number[]): number[] {
  const n = b0.length;
  const A = A0.map((r, i) => [...r, b0[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const piv = A[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = A[r][c] / piv;
      if (k) for (let j = c; j <= n; j++) A[r][j] -= k * A[c][j];
    }
  }
  return A.map((r, i) => r[n] / (r[i] || 1e-12));
}
const dotp = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

/** One simulated moment. */
export interface SimTruth {
  t: number;
  /** Where the eyes really point on the screen (px). */
  gaze: { x: number; y: number };
  head: { yaw: number; pitch: number; shiftMm: number };
  closed: boolean;
}

export class SimPerson {
  readonly cfg: SimConfig;
  private rng: Rng;
  /** Where the person wants to look (px) and where the eyes are now. */
  private target = { x: 0, y: 0 };
  private eyes = { x: 0, y: 0 };
  private targetSince = -Infinity;
  private head = { yaw: 0, pitch: 0, shiftMm: 0 };
  /** Extra head rotation imposed by a scenario (e.g. "turn your head slowly"). */
  headOffset = { yaw: 0, pitch: 0 };
  /** If set, drives headOffset over time (ms). */
  headScript: ((t: number) => { yaw: number; pitch: number }) | null = null;
  private closedByChoice = false;
  private blinkUntil = -Infinity;
  private nextBlinkAt: number;
  private lastT: number | null = null;
  /** Pixel centres of the simulated eye patch (0..1 across and down). */
  private pixels: [number, number][];
  private drift: number[];
  /** The latest truth, for scoring. */
  truth: SimTruth | null = null;
  private features: number[] = [];

  constructor(
    private screen: { w: number; h: number },
    cfg: Partial<SimConfig> = {},
  ) {
    this.cfg = { ...DEFAULT_SIM, ...cfg };
    this.rng = new Rng(this.cfg.seed);
    const d = this.cfg.featureDim;
    const cols = Math.max(2, Math.round(Math.sqrt(d * 1.6)));
    const rows = Math.max(2, Math.ceil(d / cols));
    this.pixels = Array.from({ length: d }, (_, i): [number, number] => [
      ((i % cols) + 0.5) / cols,
      (Math.floor(i / cols) + 0.5) / rows,
    ]);
    this.drift = new Array(d).fill(0);
    this.nextBlinkAt = this.cfg.blinkEveryS
      ? this.cfg.blinkEveryS * 1000 * this.rng.next()
      : Infinity;
    this.eyes = { x: screen.w / 2, y: screen.h * 0.28 };
    this.target = { ...this.eyes };
  }

  /** Look at (x, y) px from now on (the eyes get there after a short reaction time). */
  lookAt(x: number, y: number, t: number) {
    if (x === this.target.x && y === this.target.y) return;
    this.target = { x, y };
    this.targetSince = t;
  }

  closeEyes(closed: boolean) {
    this.closedByChoice = closed;
  }

  private pxPerMm() {
    return this.screen.w / SCREEN_MM;
  }

  /** Advance the simulation to time t (ms) and return this moment's face frame. */
  step(t: number): FaceFrame {
    // blinks are scheduled relative to the first frame, so runs don't depend on the clock's start
    if (this.lastT === null) this.nextBlinkAt += t;
    const dt = this.lastT === null ? 0.033 : Math.max(0.001, (t - this.lastT) / 1000);
    this.lastT = t;
    const c = this.cfg;
    const n = () => this.rng.normal();

    // head: Ornstein-Uhlenbeck wander
    const ou = (v: number, sd: number) =>
      v - (v / c.headTauS) * dt + sd * Math.sqrt((2 * dt) / c.headTauS) * n();
    this.head = {
      yaw: ou(this.head.yaw, c.headYawSd),
      pitch: ou(this.head.pitch, c.headPitchSd),
      shiftMm: ou(this.head.shiftMm, c.headShiftSd),
    };
    if (this.headScript) this.headOffset = this.headScript(t);
    const head = {
      yaw: this.head.yaw + this.headOffset.yaw,
      pitch: this.head.pitch + this.headOffset.pitch,
      shiftMm: this.head.shiftMm,
    };

    // eyes: jump to the target ~220 ms after it appears, then hold with fixational jitter
    if (t - this.targetSince >= 220) this.eyes = { ...this.target };
    const jitter = 0.25 * (this.screen.w / 28); // ~0.25 degree
    const gazePx = { x: this.eyes.x + jitter * n(), y: this.eyes.y + jitter * n() };

    // blinks
    if (t >= this.nextBlinkAt) {
      this.blinkUntil = t + 120 + 80 * this.rng.next();
      this.nextBlinkAt = t + c.blinkEveryS * 1000 * (0.4 + 1.2 * this.rng.next());
    }
    const closed = this.closedByChoice || t < this.blinkUntil;

    // eye-in-head angle = gaze direction (from where the head is) - head rotation
    const mm = this.pxPerMm();
    const gx = (gazePx.x - this.screen.w / 2) / mm - head.shiftMm;
    const gy = (gazePx.y - this.screen.h * 0.1) / mm; // camera above the screen
    const eyeYaw = deg(Math.atan2(gx, DIST_MM)) - head.yaw;
    const eyePitch = deg(Math.atan2(gy, DIST_MM)) - head.pitch;

    // drift of the eye-patch appearance (lighting, slow changes)
    const driftStep = c.driftPerMin * Math.sqrt(dt / 60);
    for (let i = 0; i < this.drift.length; i++) this.drift[i] += driftStep * n();

    // eye-patch features: each "pixel" of a small eye image is dark where the iris covers it,
    // so a pixel's value is a bump-shaped (NOT linear) function of where the eye points. That is
    // why a regression taught at only a few spots doesn't carry over to the rest of the screen.
    const yN = eyeYaw / 14;
    const pN = eyePitch / 14;
    const he = c.patchHeadEffect;
    // the eye box is found from the face, so head pose / position shift the iris inside it a bit
    const u = 0.5 + 0.3 * yN + 0.04 * he * (head.yaw / 5 + head.shiftMm / 20);
    const v = 0.5 + 0.18 * pN + 0.04 * he * (head.pitch / 5);
    const light = 8 * he * (head.yaw / 10); // turning toward / away from the light
    this.features = this.pixels.map(([cx, cy], i) => {
      const r2 = (u - cx) ** 2 + ((v - cy) * 0.6) ** 2;
      let val = 150 - 110 * Math.exp(-r2 / (2 * 0.16 ** 2)) + light;
      val += 20 * this.drift[i] + 20 * c.patchNoise * n();
      if (closed) val = 120 + 10 * n(); // the eyelid covers the eye
      return val;
    });

    this.truth = { t, gaze: gazePx, head, closed };
    const irisNoise = () => (c.irisNoiseDeg / 14) * 0.1 * n();
    const look = (v: number) => Math.max(-1, Math.min(1, v));
    return {
      t,
      blendshapes: {
        eyeBlinkLeft: closed ? 0.9 : 0.05,
        eyeBlinkRight: closed ? 0.9 : 0.05,
      },
      // MediaPipe's eyeLook blendshapes: saturating, noisy
      gaze: {
        x: look(Math.tanh(eyeYaw / 15) + 0.08 * n()),
        y: look(Math.tanh(eyePitch / 12) + 0.1 * n()),
      },
      metrics: closed
        ? { ear: 0.07 + 0.01 * n() }
        : {
            // iris position in eye widths: ~0.1 per 14 degrees horizontally, less vertically
            irisX: 0.1 * yN + irisNoise(),
            irisY: 0.05 * pN + 1.5 * irisNoise(),
            ear: 0.28 + 0.01 * n(),
          },
      landmarks: [],
      headPose: {
        yaw: head.yaw + c.headPoseNoiseDeg * n(),
        pitch: head.pitch + c.headPoseNoiseDeg * n(),
        roll: c.headPoseNoiseDeg * n(),
      },
    };
  }

  /** The eye-patch features of the latest step. */
  eyeFeatures(): number[] {
    return this.features;
  }

  /** Random draw, for scenario scripts. */
  random() {
    return this.rng.next();
  }
}

/**
 * The simulated WebGazer: learns from train() like the real one (its regression, its memory),
 * emits a prediction for each frame, and offers the frame's eye-patch features (like
 * WebGazerGaze does for the real library).
 */
export class SimWebGazer implements ScreenGaze {
  private emitter = createEmitter<GazePoint | null>();
  readonly native: WindowedRidge;
  private latest: { f: number[]; t: number } | null = null;
  trainCalls = 0;

  constructor(
    private person: SimPerson,
    memory = person.cfg.nativeMemory,
  ) {
    this.native = new WindowedRidge(memory);
  }
  async start() {}
  stop() {}
  onGaze(h: (p: GazePoint | null) => void) {
    return this.emitter.on(h);
  }
  train(x: number, y: number) {
    this.trainCalls++;
    if (this.latest) this.native.add(this.latest.f, x, y);
  }
  async clearTraining() {
    this.native.clear();
  }
  /** Features of the latest frame (what WebGazerGaze.eyeFeatures() returns for the real one). */
  eyeFeatures() {
    return this.latest;
  }
  /** Called by the harness after each face frame. */
  frame(t: number, nanRoll: number) {
    const f = this.person.eyeFeatures();
    this.latest = { f, t };
    const p = this.native.predict(f);
    if (!p) return this.emitter.emit(null);
    if (nanRoll < this.person.cfg.nanRate) return this.emitter.emit({ x: NaN, y: NaN, t });
    this.emitter.emit({ x: p.x, y: p.y, t });
  }
}
