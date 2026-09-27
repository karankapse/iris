// Calibration for screen gaze (WebGazer + the face-landmark estimate), built to get LEFT vs RIGHT
// right:
//   1. POSITION  make sure the face is centred, at a good distance and level before starting;
//   2. TRAIN     13 dots focused on the 3 answer zones and the lines between them, twice (the
//                second time in reverse order), only learning from moments when the eyes are
//                open and the head hasn't moved;
//   3. CLOSED    eyes closed (for the blink thresholds);
//   4. CHECK     6 dots the person looks at while we only measure (models fitted without them).
//                From those readings we learn a correction for each estimate (WebGazer squeezes
//                toward the middle: this stretches it back out) and how much to trust each one,
//                per axis; whether the correction helps is judged leaving each check dot out in
//                turn, never in-sample. The report shows this honest measurement. Then the check
//                readings join the training too (nothing is wasted), the models are re-fitted and
//                the correction re-learned for them;
//   5. RETRY     if a column is still weak, re-train the dots in that part of the screen once and
//                check again.
// The result is a report the setup screen can draw: where each check dot was, and where the gaze
// actually landed.
import type { CalibrationStep, FaceFrame, ScreenGaze } from '../../../contracts';
import { IDENTITY, fitAffine, type Affine, type PointPair } from '../../../core/gaze/affine';
import {
  FilteredGaze,
  eyesOpen,
  fusePoint,
  type GazeCalibration,
} from '../../../core/gaze/FilteredGaze';
import type { Zone } from './corners';
import { estimateHeadGain, type HeadGain } from '../../../core/gaze/headGain';
import { zoneAt } from './screenZones';
import { median } from './tuning';

/**
 * Training dots, focused on the 3 answer zones (plus the rest band), in percent of the screen:
 * inside each column (mid-height and at the words) and just inside the lines between columns,
 * where left / middle / right are decided. Ordered as one smooth path (no long jumps).
 * `row` groups them by height (for the up/down thresholds).
 */
export const TRAIN_DOTS: { x: number; y: number; row: number; zone: Zone }[] = [
  { x: 20, y: 28, row: 0, zone: 'center' },
  { x: 50, y: 28, row: 0, zone: 'center' },
  { x: 80, y: 28, row: 0, zone: 'center' },
  { x: 83, y: 62, row: 1, zone: 'right' },
  { x: 83, y: 84, row: 2, zone: 'right' },
  { x: 72, y: 78, row: 2, zone: 'right' }, //   just right of the right line
  { x: 61, y: 78, row: 2, zone: 'middle' }, //  just left of it
  { x: 50, y: 84, row: 2, zone: 'middle' },
  { x: 50, y: 62, row: 1, zone: 'middle' },
  { x: 39, y: 78, row: 2, zone: 'middle' }, //  just right of the left line
  { x: 28, y: 78, row: 2, zone: 'left' }, //    just left of it
  { x: 17, y: 84, row: 2, zone: 'left' },
  { x: 17, y: 62, row: 1, zone: 'left' },
];

/** Check dots: the rest band at the top and the words at the bottom of each column. */
export const CHECK_POINTS: { pos: { x: number; y: number }; zone: Zone }[] = [
  { pos: { x: 17, y: 30 }, zone: 'center' },
  { pos: { x: 50, y: 30 }, zone: 'center' },
  { pos: { x: 83, y: 30 }, zone: 'center' },
  { pos: { x: 17, y: 84 }, zone: 'left' },
  { pos: { x: 50, y: 84 }, zone: 'middle' },
  { pos: { x: 83, y: 84 }, zone: 'right' },
];

export const TIMING = {
  positionTickMs: 250,
  positionMaxMs: 10000,
  positionGoodMs: 1000,
  firstSettleMs: 1200,
  settleMs: 700,
  repeatSettleMs: 500,
  collectMs: 1200,
  extendMs: 800,
  trainEveryMs: 75,
  closedMs: 2500,
  checkSettleMs: 700,
  checkMs: 1000,
  headMs: 8000,
};
/** Fewer good samples than this at a dot = it's collected for longer. */
const MIN_GOOD_SAMPLES = 10;
/** Head moved more than this (degrees) from where it was at the start = don't learn from that moment. */
const MAX_HEAD_MOVE = 12;
/** A zone below this share of hits gets re-trained once. */
const WEAK_ZONE = 0.7;
const MIN_CHECK_READINGS = 5;
/** One estimate more than this many times worse than the other is left out completely. */
const MUCH_WORSE = 2;
/** The correction must beat the raw tracker by at least this much on the check dots, or it isn't used. */
const MIN_IMPROVEMENT = 0.95;

export interface CheckPointResult {
  /** Percent of the screen. */
  target: { x: number; y: number };
  zone: Zone;
  /** Final (corrected + fused) readings as screen fractions, for drawing. */
  readings: { x: number; y: number }[];
  hitRate: number;
  errorPx: number;
}

export interface CalibrationReport {
  at: number;
  viewport: { w: number; h: number };
  points: CheckPointResult[];
  zones: Record<Zone, number>;
  /** Share of all check readings in the right box. */
  overall: number;
  /** Average left-right error on the answer row (px). */
  horizontalErrorPx: number;
  /** Share given to WebGazer per axis (the rest: face landmarks). null = WebGazer only. */
  weights: { x: number; y: number } | null;
  /** Typical error of each estimate after correction (px). */
  errors: { tracker: { x: number; y: number }; landmark: { x: number; y: number } | null };
  retried: Zone[];
  /** Average distance from the check dots (px): the plain tracker vs. what the app now uses. */
  rawErrorPx: number;
  finalErrorPx: number;
  /** False = the correction didn't help on the check dots, so the plain tracker is used. */
  correctionUsed: boolean;
  /** What was wrong with the position, if it never got good. */
  positionIssue: string | null;
  /** Head compensation learned from the data (px per degree; 0 = off), if it was learned. */
  headGain?: HeadGain & { fromHeadStep: boolean };
}

/** Plain-language advice about the face position, or null when it's good. */
export function positionAdvice(frame: FaceFrame | null, now: number): string | null {
  if (!frame || now - frame.t > 500) return "I can't see your face. Sit in front of the camera.";
  const L = frame.landmarks;
  if (L.length >= 468) {
    const eyeSpan = Math.abs(L[263].x - L[33].x); // outer eye corners, share of the image width
    if (eyeSpan < 0.09) return 'Move a little closer to the screen';
    if (eyeSpan > 0.3) return 'Move back a little';
    const cx = (L[263].x + L[33].x) / 2;
    // the camera image is not mirrored: a face on the image's left is on the person's right
    if (cx < 0.33) return 'Move a little to your left';
    if (cx > 0.67) return 'Move a little to your right';
    const cy = (L[263].y + L[33].y) / 2;
    if (cy < 0.2)
      return 'Tilt the screen back a little (your face is near the top of the camera view)';
    if (cy > 0.75)
      return 'Tilt the screen forward a little (your face is near the bottom of the camera view)';
  }
  if (Math.abs(frame.headPose.roll) > 10) return 'Keep your head level';
  if (Math.abs(frame.headPose.yaw) > 15) return 'Turn your face straight toward the screen';
  if (!eyesOpen(frame)) return 'Open your eyes and look at the dot';
  return null;
}

interface Deps {
  gaze: ScreenGaze;
  onStep?: (step: CalibrationStep) => void;
  /** Frames arriving during each phase are filed under this key (for the blink thresholds). */
  setPhase: (key: string | null) => void;
  viewport?: () => { w: number; h: number };
  sleep?: (ms: number) => Promise<void>;
  options?: Partial<CalibrationOptions>;
}

export interface CalibrationOptions {
  /** The check round's readings also become training data once measured (default true). */
  learnFromCheck: boolean;
  /** Learn the head-turn / nod compensation from the calibration data (default true). */
  learnHeadGain: boolean;
  /**
   * An extra step: keep looking at one dot while slowly turning the head (default false: many
   * people who need Iris cannot move their head, and for them it doesn't matter much).
   */
  headStep: boolean;
  /** Passes over the training dots (the second in reverse order), and a scale for their length. */
  passes: number;
  collectScale: number;
}

/**
 * Two half-length passes (the second in reverse order) rather than one: in simulation, at the same
 * total time (~47 s), the horizontal error in use was 32 px vs 46 px for one longer pass (7
 * people): samples of each dot from two different moments teach the models what stays the same
 * while the head and light drift a little.
 */
const DEFAULT_OPTIONS: CalibrationOptions = {
  learnFromCheck: true,
  learnHeadGain: true,
  headStep: false,
  passes: 2,
  collectScale: 0.5,
};

/** Group number of the head-turn step's dot. */
const HEAD_GROUP = 200;
const HEAD_DOT = { x: 50, y: 62 };

interface Reading {
  raw: { x: number; y: number };
  landmark: { x: number; y: number } | null;
}

/** Group numbers of the check dots (training dots use their index, 0..12). */
const CHECK_GROUP = 100;

export class ScreenCalibration {
  private latest: FaceFrame | null = null;
  private lastClosedAt = -Infinity;
  private headRef: { yaw: number; pitch: number } | null = null;
  private stepIndex = 0;
  private total = 1 + TRAIN_DOTS.length + 1 + CHECK_POINTS.length;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly viewport: () => { w: number; h: number };
  private readonly filtered: FilteredGaze | null;
  private readonly options: CalibrationOptions;

  constructor(private deps: Deps) {
    this.options = { ...DEFAULT_OPTIONS, ...deps.options };
    if (this.options.headStep) this.total++;
    this.total += TRAIN_DOTS.length * (Math.max(1, Math.round(this.options.passes)) - 1);
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.viewport = deps.viewport ?? (() => ({ w: window.innerWidth, h: window.innerHeight }));
    this.filtered = deps.gaze instanceof FilteredGaze ? deps.gaze : null;
  }

  /** Feed every face frame here while calibrating. */
  observe(frame: FaceFrame) {
    this.latest = frame;
    if (!eyesOpen(frame)) this.lastClosedAt = frame.t;
  }

  async run(): Promise<{ report: CalibrationReport; warnings: string[] }> {
    const warnings: string[] = [];
    await this.deps.gaze.clearTraining();

    const positionIssue = await this.position();
    if (positionIssue) warnings.push(`Position: ${positionIssue.toLowerCase()}.`);

    let hardDots = 0;
    // one pass over the dots, or several (each in the opposite order, each proportionally shorter)
    const passes = Math.max(1, Math.round(this.options.passes));
    const collectMs = TIMING.collectMs * this.options.collectScale;
    for (let pass = 0; pass < passes; pass++) {
      const order = TRAIN_DOTS.map((dot, i) => ({ dot, i }));
      if (pass % 2) order.reverse();
      for (const [k, { dot, i }] of order.entries()) {
        // later passes: the dots are familiar, so a shorter settle is enough
        const settle =
          pass === 0 ? (k === 0 ? TIMING.firstSettleMs : TIMING.settleMs) : TIMING.repeatSettleMs;
        const good = await this.trainDot(
          i,
          dot,
          settle,
          undefined,
          collectMs,
          MIN_GOOD_SAMPLES / passes,
        );
        if (good < MIN_GOOD_SAMPLES / (2 * passes)) hardDots++;
      }
    }
    if (hardDots) {
      warnings.push(
        `${hardDots} of ${TRAIN_DOTS.length} dots were hard to learn (blinks or head movement).`,
      );
    }

    this.deps.setPhase('closed');
    this.step('closed', 'Close your eyes gently and keep them closed', TIMING.closedMs / 1000);
    await this.sleep(TIMING.closedMs);
    this.deps.setPhase(null);

    this.fit();
    let report = await this.check([], positionIssue, 1);

    // one targeted retry for weak parts of the screen
    const weak = (Object.keys(report.zones) as Zone[]).filter((z) => report.zones[z] < WEAK_ZONE);
    if (weak.length) {
      // redo the dots in each weak zone
      const redo = TRAIN_DOTS.map((p, i) => ({ p, i })).filter(({ p }) => weak.includes(p.zone));
      this.total += redo.length + CHECK_POINTS.length;
      for (const { p, i } of redo)
        await this.trainDot(i, p, TIMING.settleMs, 'One more time: look at the dot');
      this.deps.setPhase(null);
      this.fit();
      report = await this.check(weak, positionIssue, 2);
    }

    if (this.filtered && this.options.headStep) await this.headStep();
    const headGain = this.learnHeadGain();
    if (headGain) report = { ...report, headGain };

    for (const z of Object.keys(report.zones) as Zone[]) {
      if (report.zones[z] < 0.6) {
        warnings.push(
          `${ZONE_NAME[z]}: only ${Math.round(report.zones[z] * 100)}% of readings landed in the right box.`,
        );
      }
    }
    return { report, warnings };
  }

  // ---- phases ---------------------------------------------------------------------------------

  /** Wait until the face is well placed (or give up after a while and say what was wrong). */
  private async position(): Promise<string | null> {
    let goodFor = 0;
    let advice: string | null = null;
    const head: { yaw: number; pitch: number }[] = [];
    for (let waited = 0; waited < TIMING.positionMaxMs; waited += TIMING.positionTickMs) {
      advice = positionAdvice(this.latest, performance.now());
      const remaining = Math.ceil((TIMING.positionMaxMs - waited) / 1000);
      this.step('center', advice ?? 'Great, hold still and look at the dot', remaining, false);
      if (!advice && this.latest) {
        goodFor += TIMING.positionTickMs;
        head.push({ yaw: this.latest.headPose.yaw, pitch: this.latest.headPose.pitch });
        if (goodFor >= TIMING.positionGoodMs) break;
      } else goodFor = 0;
      await this.sleep(TIMING.positionTickMs);
    }
    this.stepIndex++;
    if (head.length) {
      this.headRef = {
        yaw: median(head.map((h) => h.yaw)),
        pitch: median(head.map((h) => h.pitch)),
      };
    }
    return goodFor >= TIMING.positionGoodMs ? null : advice;
  }

  /** Show one dot and teach the trackers from the good moments. Returns how many were good. */
  private async trainDot(
    index: number,
    dot: { x: number; y: number },
    settleMs: number,
    prompt?: string,
    collectMs = TIMING.collectMs,
    minGood = MIN_GOOD_SAMPLES,
  ) {
    const at = this.px(dot);
    const shown = { x: dot.x, y: dot.y }; // only the position goes to the screen
    this.filtered?.markPoint(index);
    this.deps.setPhase(`row${TRAIN_DOTS[index]?.row ?? 0}`); // frames by row, for the up/down thresholds
    const seconds = (settleMs + collectMs) / 1000;
    this.step(
      'point',
      prompt ?? (index === 0 ? 'Look at the dot' : 'Follow the dot'),
      seconds,
      true,
      shown,
    );
    await this.sleep(settleMs);
    let good = 0;
    let headMoves = 0;
    for (
      let waited = 0;
      waited < collectMs || (good < minGood && waited < collectMs + TIMING.extendMs);
      waited += TIMING.trainEveryMs
    ) {
      const verdict = this.sampleOk();
      if (verdict === 'ok') {
        this.deps.gaze.train(at.x, at.y);
        good++;
      } else if (verdict === 'head' && ++headMoves === 6) {
        this.step('point', 'Keep your head still, move only your eyes', seconds, false, shown);
      }
      await this.sleep(TIMING.trainEveryMs);
    }
    return good;
  }

  /** Is RIGHT NOW a good moment to learn from? */
  private sampleOk(): 'ok' | 'face' | 'blink' | 'head' {
    const f = this.latest;
    const now = performance.now();
    if (!f || now - f.t > 250) return 'face';
    // eyes open, and not just re-opened (they roll back into place for a moment)
    if (!eyesOpen(f) || now - this.lastClosedAt < 250) return 'blink';
    if (this.headRef) {
      const dy = Math.abs(f.headPose.yaw - this.headRef.yaw);
      const dp = Math.abs(f.headPose.pitch - this.headRef.pitch);
      if (dy > MAX_HEAD_MOVE || dp > MAX_HEAD_MOVE) return 'head';
    }
    return 'ok';
  }

  /** The check round: measure, learn corrections + fusion weights, and score the result. */
  private async check(
    retried: Zone[],
    positionIssue: string | null,
    round: number,
  ): Promise<CalibrationReport> {
    const vp = this.viewport();
    const live: Reading[][] = [];
    for (const [j, cp] of CHECK_POINTS.entries()) {
      this.step(
        'point',
        'Look at the dot (checking accuracy)',
        (TIMING.checkSettleMs + TIMING.checkMs) / 1000,
        true,
        cp.pos,
      );
      await this.sleep(TIMING.checkSettleMs);
      const at = this.px(cp.pos);
      let n = 0;
      if (this.filtered) {
        // measure only (the tracker is not taught here), keeping every sample for later
        this.filtered.markPoint(CHECK_GROUP + j, round);
        for (let waited = 0; waited < TIMING.checkMs; waited += TIMING.trainEveryMs) {
          if (this.sampleOk() !== 'blink' && this.filtered.observe(at.x, at.y, 'check')) n++;
          await this.sleep(TIMING.trainEveryMs);
        }
      } else {
        const readings: Reading[] = [];
        const off = this.deps.gaze.onGaze((p) => {
          if (p && this.sampleOk() !== 'blink') readings.push({ raw: p, landmark: null });
        });
        await this.sleep(TIMING.checkMs);
        off();
        live.push(readings);
        n = readings.length;
      }
      if (n < MIN_CHECK_READINGS) {
        throw new Error(
          "I couldn't get gaze readings while checking. Make sure the camera can see your face, then try again.",
        );
      }
    }
    // Measured honestly: the models as they were BEFORE seeing any check dot.
    const perPoint = this.filtered ? this.checkReadings(round, 'measured') : live;
    if (perPoint.some((r) => r.length < MIN_CHECK_READINGS)) {
      throw new Error(
        "I couldn't get gaze readings while checking. Make sure the camera can see your face, then try again.",
      );
    }

    const targets = CHECK_POINTS.map((cp) => this.px(cp.pos));
    const all = CHECK_POINTS.map((_, i) => i);
    /** Corrections + weights learned from the check dots listed in `use`. */
    const learnFrom = (readings: Reading[][], use: number[]) => {
      const landmark = this.filtered?.calibration().landmark ?? null;
      const learned = this.learnCorrection(
        use.map((i) => readings[i]),
        use.map((i) => targets[i]),
        vp,
        !!landmark,
      );
      const cal: GazeCalibration = {
        webgazerFix: learned.webgazerFix,
        landmarkFix: learned.landmarkFix,
        weights: learned.weights,
        landmark,
      };
      return { cal, errors: learned.errors };
    };
    const learned = learnFrom(perPoint, all);
    // Honest check of the correction: for each check dot, learn it from the OTHER dots only.
    const heldOut = all.map(
      (i) =>
        learnFrom(
          perPoint,
          all.filter((k) => k !== i),
        ).cal,
    );
    const rawCal: GazeCalibration = {
      webgazerFix: IDENTITY,
      landmarkFix: IDENTITY,
      weights: { x: 1, y: 1 },
      landmark: null,
    };
    /** Where each reading of dot i lands with the calibration chosen for dot i. */
    const placed = (calFor: (i: number) => GazeCalibration) =>
      perPoint.map((readings, i) => readings.map((r) => fusePoint(calFor(i), r.raw, r.landmark)));
    const meanError = (pts: { x: number; y: number }[][]) =>
      avg(
        pts.flatMap((ps, i) => ps.map((p) => Math.hypot(p.x - targets[i].x, p.y - targets[i].y))),
      );
    const rawPlaced = placed(() => rawCal);
    const learnedPlaced = placed((i) => heldOut[i]);
    const rawErrorPx = meanError(rawPlaced);
    const learnedErrorPx = meanError(learnedPlaced);
    // Do no harm: keep the correction only if it clearly beats the plain tracker.
    const correctionUsed =
      Number.isFinite(learnedErrorPx) && learnedErrorPx < MIN_IMPROVEMENT * rawErrorPx;
    let cal = correctionUsed ? learned.cal : { ...rawCal, landmark: learned.cal.landmark };

    // Nothing wasted: the check dots now join the training, the models are re-fitted, and the
    // correction is re-learned for the re-fitted models (from their predictions at the check
    // dots). In simulation this beats both "measure only" and learning the correction from
    // held-out predictions (those are more pessimistic than use, where the person looks at spots
    // the model was trained on, so the correction over-stretches).
    if (this.filtered && this.options.learnFromCheck) {
      this.fit();
      const refit = this.checkReadings(round, 'refit');
      if (refit.every((r) => r.length >= MIN_CHECK_READINGS)) {
        const again = learnFrom(refit, all).cal;
        cal = correctionUsed ? again : { ...rawCal, landmark: again.landmark };
      }
    }
    this.filtered?.setCorrection({
      webgazerFix: cal.webgazerFix,
      landmarkFix: cal.landmarkFix,
      weights: cal.weights,
    });

    // score what the app will now use, on dots it did not learn from
    const final = correctionUsed ? learnedPlaced : rawPlaced;
    const points: CheckPointResult[] = CHECK_POINTS.map((cp, i) => {
      const ps = final[i];
      const hits = ps.filter((p) => zoneAt(p.x, p.y, vp) === cp.zone).length;
      const err = avg(ps.map((p) => Math.hypot(p.x - targets[i].x, p.y - targets[i].y)));
      return {
        target: cp.pos,
        zone: cp.zone,
        readings: thin(ps, 30).map((p) => ({ x: p.x / vp.w, y: p.y / vp.h })),
        hitRate: hits / ps.length,
        errorPx: err,
      };
    });
    const zones = {} as Record<Zone, number>;
    for (const z of ['center', 'left', 'middle', 'right'] as Zone[]) {
      const ps = points.filter((p) => p.zone === z);
      zones[z] = avg(ps.map((p) => p.hitRate));
    }
    const count = final.flat().length;
    const overall = points.reduce((s, p, i) => s + p.hitRate * final[i].length, 0) / count;
    const horizontalErrorPx = avg(
      CHECK_POINTS.flatMap((cp, i) =>
        cp.zone === 'center' ? [] : final[i].map((p) => Math.abs(p.x - targets[i].x)),
      ),
    );
    return {
      at: Date.now(),
      viewport: vp,
      points,
      zones,
      overall,
      horizontalErrorPx,
      weights: correctionUsed && cal.landmark ? cal.weights : null,
      errors: learned.errors,
      rawErrorPx,
      finalErrorPx: correctionUsed ? learnedErrorPx : rawErrorPx,
      correctionUsed,
      retried,
      positionIssue,
    };
  }

  /**
   * What each estimate says for every check-dot sample:
   *  'measured': the models fitted WITHOUT any check dot (an honest measurement);
   *  'refit':    the current models, after the check dots joined the training.
   * When the tracker's own regression is used (no eye-patch features), its live estimate from this
   * round is used: it is never taught the check dots.
   */
  private checkReadings(round: number, which: 'measured' | 'refit'): Reading[][] {
    const filtered = this.filtered!;
    if (which === 'measured') filtered.fitModels({ exclude: ['check'] });
    const own = filtered.usesPatchModel();
    return CHECK_POINTS.map((_, j) =>
      filtered
        .samples()
        .filter(
          (s) => s.kind === 'check' && s.group === CHECK_GROUP + j && (own || s.round === round),
        )
        .flatMap((s): Reading[] => {
          const p = filtered.predictSample(s);
          const raw = own ? p.tracker : s.native;
          return raw ? [{ raw, landmark: p.landmark }] : [];
        }),
    );
  }

  /**
   * Fit a correction per estimate (median reading per dot -> true position), measure how far off
   * each still is, and weigh them by inverse error variance, per axis.
   */
  private learnCorrection(
    perPoint: Reading[][],
    targets: { x: number; y: number }[],
    vp: { w: number; h: number },
    hasLandmarks: boolean,
  ) {
    const pairs = (pick: (r: Reading) => { x: number; y: number } | null) =>
      perPoint.flatMap((readings, i): PointPair[] => {
        const ps = readings.map(pick).filter((p): p is { x: number; y: number } => !!p);
        if (ps.length < MIN_CHECK_READINGS) return [];
        return [
          {
            px: median(ps.map((p) => p.x)),
            py: median(ps.map((p) => p.y)),
            tx: targets[i].x,
            ty: targets[i].y,
          },
        ];
      });
    const webgazerFix =
      fitAffine(
        pairs((r) => r.raw),
        vp,
      ) ?? IDENTITY;
    const lmPairs = hasLandmarks ? pairs((r) => r.landmark) : [];
    const landmarkFix = (lmPairs.length >= 4 && fitAffine(lmPairs, vp)) || IDENTITY;

    /** RMS error after correction; `paired` = only moments where both estimates exist (fair comparison). */
    const rms = (
      fix: Affine,
      pick: (r: Reading) => { x: number; y: number } | null,
      paired: boolean,
    ) => {
      let sx = 0;
      let sy = 0;
      let n = 0;
      perPoint.forEach((readings, i) => {
        for (const r of readings) {
          const p = pick(r);
          if (!p || (paired && !r.landmark)) continue;
          const c = { x: fix.a * p.x + fix.b * p.y + fix.c, y: fix.d * p.x + fix.e * p.y + fix.f };
          sx += (c.x - targets[i].x) ** 2;
          sy += (c.y - targets[i].y) ** 2;
          n++;
        }
      });
      return n >= 20 ? { x: Math.sqrt(sx / n), y: Math.sqrt(sy / n) } : null;
    };
    const trackerPaired = rms(webgazerFix, (r) => r.raw, true);
    const landmark = lmPairs.length >= 4 ? rms(landmarkFix, (r) => r.landmark, true) : null;
    // Share for the tracker: by inverse error variance, but an estimate that is much worse than
    // the other gets nothing (even a small share of a wild estimate drags the dot away).
    const share = (t: number, l: number) =>
      l > MUCH_WORSE * t ? 1 : t > MUCH_WORSE * l ? 0 : (l * l) / (t * t + l * l || 1);
    const weights =
      trackerPaired && landmark
        ? { x: share(trackerPaired.x, landmark.x), y: share(trackerPaired.y, landmark.y) }
        : { x: 1, y: 1 };
    const tracker = rms(webgazerFix, (r) => r.raw, false) ?? { x: NaN, y: NaN };
    return { webgazerFix, landmarkFix, weights, errors: { tracker, landmark } };
  }

  // ---- helpers --------------------------------------------------------------------------------

  /** (Re-)fit both gaze models from what has been collected. */
  private fit() {
    if (this.filtered) this.filtered.excludeCheck = !this.options.learnFromCheck;
    this.filtered?.fitModels({
      exclude: this.options.learnFromCheck ? ['head'] : ['head', 'check'],
    });
  }

  /** Optional: look at one dot while slowly turning the head (for the head compensation). */
  private async headStep() {
    const at = this.px(HEAD_DOT);
    this.filtered!.markPoint(HEAD_GROUP);
    this.step(
      'point',
      'Keep looking at the dot and slowly turn your head left and right, then nod',
      (TIMING.settleMs + TIMING.headMs) / 1000,
      true,
      HEAD_DOT,
    );
    await this.sleep(TIMING.settleMs);
    for (let waited = 0; waited < TIMING.headMs; waited += TIMING.trainEveryMs) {
      if (this.sampleOk() !== 'blink') this.filtered!.observe(at.x, at.y, 'head');
      await this.sleep(TIMING.trainEveryMs);
    }
    this.fit(); // (head-step samples are only predicted, never trained on)
  }

  /**
   * Learn how much head rotation moves the estimate, from moments where we know where the person
   * looked, using predictions from models that did not train on that dot. Sets FilteredGaze's
   * head gains (0 when the data can't tell).
   */
  private learnHeadGain(): (HeadGain & { fromHeadStep: boolean }) | null {
    const f = this.filtered;
    const base = f?.headBaseline();
    if (!f || !base || !this.options.learnHeadGain) return null;
    const cal = f.calibration();
    const own = f.usesPatchModel();
    const points = f.samples().flatMap((s) => {
      const tracker = own ? s.cvTracker : s.native;
      if (!s.head || !tracker || s.kind === 'online') return [];
      const p = fusePoint(cal, tracker, s.cvLandmark ?? null);
      return [
        {
          residX: s.x - p.x,
          residY: s.y - p.y,
          yaw: s.head.yaw - base.yaw,
          pitch: s.head.pitch - base.pitch,
          group: s.group,
        },
      ];
    });
    const gain = estimateHeadGain(points);
    f.setParams({ headGainX: Math.round(gain.gainX), headGainY: Math.round(gain.gainY) });
    return { ...gain, fromHeadStep: points.some((p) => p.group === HEAD_GROUP) };
  }

  private step(
    target: CalibrationStep['target'],
    prompt: string,
    seconds: number,
    advance = true,
    position?: { x: number; y: number },
  ) {
    if (advance) this.stepIndex++;
    this.deps.onStep?.({
      target,
      position,
      prompt,
      seconds,
      index: Math.max(1, this.stepIndex),
      total: this.total,
    });
  }

  private px(pos: { x: number; y: number }) {
    const vp = this.viewport();
    return { x: (pos.x / 100) * vp.w, y: (pos.y / 100) * vp.h };
  }
}

const ZONE_NAME: Record<Zone, string> = {
  center: 'The rest area',
  left: 'The left column',
  middle: 'The middle column',
  right: 'The right column',
};

const avg = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN);

/** At most `n` items, evenly spread. */
function thin<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]);
}
