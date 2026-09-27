import { TARGET_POSITION, optionRegions } from '../../../contracts';
import type {
  CalibrationStep,
  EyeEvent,
  EyeInput,
  EyeMode,
  FaceFrame,
  EyeSettings,
  FaceTracker,
  GazePoint,
  ScreenGaze,
} from '../../../contracts';
import { createEmitter } from '../../../core/emitter';
import { BlinkDetector, type BlinkOutcome } from './blink';
import {
  CornerTracker,
  defaultCornerModel,
  gazeFeatures,
  loadCornerModel,
  saveCornerModel,
  trainCornerModel,
  ZONES,
  type Zone,
} from './corners';
import { GazeStepper } from './gaze';
import { ScreenZoneTracker, zoneAt } from './screenZones';
import {
  loadTuning,
  median,
  saveTuning,
  tuningFromSamples,
  type CalibrationSamples,
  type EyeTuning,
} from './tuning';

/**
 * HOW THE USER CONTROLS THE APP WITH THEIR EYES
 * ---------------------------------------------
 * FULL mode: up to 4 options sit in the four CORNERS of the screen (a 2x2 grid).
 *   look at a corner        -> its option is highlighted
 *   keep looking (dwell)    -> a bar fills; when full, the option is SELECTED
 *   blink deliberately      -> selects the highlighted option immediately (faster than dwell)
 *   look at the centre      -> rest: nothing is highlighted and dwell restarts
 *   Which corner you are looking at is decided by a personal classifier trained during
 *   calibration (see corners.ts).
 *
 * VERTICAL mode (for people who can only move their eyes up and down):
 *   options are stacked in a list; look UP / DOWN and hold to move the highlight,
 *   then blink deliberately to SELECT.
 *
 * BOTH modes:
 *   deliberate blink = eyes closed ~0.5 s or more (natural blinks are ignored)
 *   keep the eyes closed ~1.5 s = CANCEL / go back
 *
 * Safety: after any selection, or when the screen changes, dwell is disarmed until the person
 * looks back at the centre, so a resting gaze never selects the next screen's option by itself.
 */

const BLINK_KEYS = ['eyeBlinkLeft', 'eyeBlinkRight'] as const;
/** Skip the first part of each calibration step: people need a moment to find the dot. */
const CALIBRATION_REACTION_MS = 900;
const MIN_CALIBRATION_FRAMES = 10;
const PROGRESS_STEP = 0.05;

// Screen-gaze calibration (WebGazer). Positions are percent of the screen.
const SCREEN_CALIBRATED_KEY = 'iris.gazeCalibrated';
const SETTLE_MS = 900; // time to find the dot
const TRAIN_MS = 1500;
const TRAIN_EVERY_MS = 75;
const CHECK_MS = 1200;
const TRAIN_POINTS: { key: string; pos: { x: number; y: number } }[] = [
  { key: 'center', pos: TARGET_POSITION.center },
  { key: 'left', pos: TARGET_POSITION.left },
  { key: 'middle', pos: TARGET_POSITION.middle },
  { key: 'right', pos: TARGET_POSITION.right },
  // extra points spread over the rest band and the columns, so the mapping is learned everywhere
  { key: 'rest-left', pos: { x: 32, y: 28 } }, //   "Partner said"
  { key: 'rest-right', pos: { x: 68, y: 28 } }, //  the face view
  { key: 'col-left', pos: { x: TARGET_POSITION.left.x, y: 74 } },
  { key: 'col-middle', pos: { x: TARGET_POSITION.middle.x, y: 74 } },
  { key: 'col-right', pos: { x: TARGET_POSITION.right.x, y: 74 } },
];
const CHECK_ZONES: Zone[] = ['center', 'left', 'middle', 'right'];
const ZONE_LABEL: Record<Zone, string> = {
  center: 'The rest area',
  left: 'The left column',
  middle: 'The middle column',
  right: 'The right column',
};

function screenCalibrated(): boolean {
  try {
    return localStorage.getItem(SCREEN_CALIBRATED_KEY) === '1';
  } catch {
    return false;
  }
}

type StepKey = Zone | 'up' | 'down' | 'closed';
interface StepDef {
  key: StepKey;
  target: CalibrationStep['target'];
  prompt: string;
  seconds: number;
}

const COLUMN_NAME: Record<string, string> = {
  left: 'left',
  middle: 'middle',
  right: 'right',
};

const FULL_STEPS: StepDef[] = [
  {
    key: 'center',
    target: 'center',
    prompt: 'Look at the dot at the top (the rest area)',
    seconds: 3,
  },
  ...(['left', 'middle', 'right'] as const).map((z) => ({
    key: z,
    target: z,
    prompt: `Look at the words in the ${COLUMN_NAME[z]} column`,
    seconds: 3,
  })),
  {
    key: 'closed',
    target: 'closed',
    prompt: 'Close your eyes gently and keep them closed',
    seconds: 2.5,
  },
];

const VERTICAL_STEPS: StepDef[] = [
  { key: 'center', target: 'center', prompt: 'Look at the dot in the middle', seconds: 3 },
  { key: 'up', target: 'up', prompt: 'Look at the dot at the top', seconds: 3 },
  { key: 'down', target: 'down', prompt: 'Look at the dot at the bottom', seconds: 3 },
  {
    key: 'closed',
    target: 'closed',
    prompt: 'Close your eyes gently and keep them closed',
    seconds: 2.5,
  },
];

/** 0 (open) .. 1 (closed). Average of both eyes so a face that can't close one eye fully still works. */
export function blinkScore(frame: FaceFrame): number {
  return BLINK_KEYS.reduce((sum, k) => sum + (frame.blendshapes[k] ?? 0), 0) / BLINK_KEYS.length;
}

export class RealEyeInput implements EyeInput {
  private emitter = createEmitter<EyeEvent>();
  private tuning: EyeTuning = loadTuning();
  private blink = new BlinkDetector(this.tuning);
  private stepper = new GazeStepper(this.tuning); // vertical mode

  private savedModel = loadCornerModel();
  private corners = new CornerTracker(
    this.savedModel ?? defaultCornerModel(),
    this.tuning.regionHoldMs,
  ); // full mode

  private unsubscribe: (() => void) | null = null;
  private mode: EyeMode = 'full';
  private optionCount = 0;
  private highlighted: number | null = null;
  private lastProgress = 0;
  private blinkEndedAt = -Infinity;
  private lastFrameAt = -Infinity;
  private lastGazeAt = -Infinity;
  private blinkProgress = 0;
  private settling = false;
  private currentZone: Zone = 'center';
  private calibrating = false;
  private accuracy: number | undefined;
  /** Screen-coordinate gaze (WebGazer / mouse). null = use the MediaPipe corner classifier. */
  private zones = new ScreenZoneTracker(this.tuning.regionHoldMs);
  private unsubscribeGaze: (() => void) | null = null;

  // dwell (full mode)
  private dwellZone: Zone | null = null;
  private dwellStart = 0;
  /** False after a selection / screen change, until the person looks back at the centre. */
  private armed = false;

  /** While calibrating, frames go here instead of controlling the app. */
  private collector: ((frame: FaceFrame) => void) | null = null;

  constructor(
    private tracker: FaceTracker,
    private gaze: ScreenGaze | null = null,
  ) {}

  start(options: { mode: EyeMode; optionCount: number }) {
    this.unsubscribe?.();
    this.mode = options.mode;
    this.corners.reset();
    this.zones.reset();
    this.stepper.reset();
    this.unsubscribe = this.tracker.onFrame((frame) => this.onFrame(frame));
    this.unsubscribeGaze?.();
    this.unsubscribeGaze = this.gaze?.onGaze((p) => this.onGaze(p)) ?? null;
    this.setOptionCount(options.optionCount);
  }

  setOptionCount(optionCount: number) {
    this.optionCount = optionCount;
    this.blink.invalidate(); // a blink that began on the previous screen must not act here
    this.stepper.reset();
    this.armed = false; // no dwell-select on a fresh screen until the gaze has rested at the centre
    this.dwellZone = null;
    const index =
      this.mode === 'full' ? this.optionAt(this.currentZone) : optionCount > 0 ? 0 : null;
    this.setHighlight(index, 0);
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeGaze?.();
    this.unsubscribeGaze = null;
  }

  on(handler: (event: EyeEvent) => void) {
    return this.emitter.on(handler);
  }

  /**
   * Apply the user's adjustable settings. They override the calibrated values for dwell time,
   * blink length and gaze steadiness (calibration still decides where the eyes are).
   */
  configure(settings: EyeSettings) {
    this.tuning = {
      ...this.tuning,
      dwellMs: settings.dwellMs,
      selectMs: settings.blinkMs,
      cancelMs: settings.blinkMs + 1000, // keep "hold the eyes closed" clearly longer than a select blink
      regionHoldMs: settings.steadinessMs,
    };
    this.blink.setTuning(this.tuning);
    this.blink.setDoubleBlink(settings.doubleBlinkBack);
    this.stepper.setTuning(this.tuning);
    this.zones.setHoldMs(this.tuning.regionHoldMs);
    this.corners.setHoldMs(this.tuning.regionHoldMs);
  }

  status() {
    return {
      region: this.mode === 'full' ? this.currentZone : null,
      calibrated:
        this.mode !== 'full' ? true : this.gaze ? screenCalibrated() : this.savedModel !== null,
      accuracy: this.accuracy,
    };
  }

  /** The option that sits in `zone` on the current screen (full mode), if any. */
  private optionAt(zone: Zone): number | null {
    if (zone === 'center') return null;
    const index = optionRegions(this.optionCount, 'full').indexOf(zone);
    return index === -1 ? null : index;
  }

  // ---- per-frame control ------------------------------------------------------------
  private onFrame(frame: FaceFrame) {
    if (this.collector) return this.collector(frame);
    if (this.calibrating) return;

    // Face lost for a moment: whatever gaze we were tracking is stale. Start fresh and wait
    // for the person to look at the centre again before any dwell can complete.
    if (frame.t - this.lastFrameAt > this.tuning.frameGapMs) {
      this.corners.reset();
      this.dwellZone = null;
      this.armed = false;
    }
    this.lastFrameAt = frame.t;

    const { outcome, progress } = this.blink.update(frame.t, blinkScore(frame));
    this.blinkProgress = progress;
    if (this.blink.closed) this.blinkEndedAt = frame.t;
    // Eyes roll while closing and opening, so freeze gaze around blinks.
    this.settling = this.blink.closed || frame.t - this.blinkEndedAt < this.tuning.settleMs;

    if (this.mode === 'full') {
      // With screen gaze, zones come from onGaze(); here only the blink can act on the current zone.
      const zone = this.gaze
        ? this.currentZone
        : this.corners.update(frame.t, gazeFeatures(frame), this.settling);
      this.applyZone(frame.t, zone, outcome);
    } else this.onFrameVertical(frame, outcome, progress, this.settling);

    // holding the eyes closed cancels; so does a double blink, if the user turned that on
    if (outcome === 'cancel' || outcome === 'double') this.emitter.emit({ type: 'cancel' });
  }

  /** A screen-gaze estimate (WebGazer or the mouse): decide which box it is in. */
  private onGaze(p: GazePoint | null) {
    if (!p || this.collector || this.calibrating || this.mode !== 'full') return;
    if (p.t - this.lastGazeAt > this.tuning.frameGapMs * 3) {
      // gaze estimates stopped for a while: start fresh
      this.zones.reset();
      this.dwellZone = null;
      this.armed = false;
    }
    this.lastGazeAt = p.t;
    const zone = this.zones.update(p.t, p, this.settling);
    this.applyZone(p.t, zone, null);
  }

  /** Dwell + blink selection for the zone currently looked at (full mode). */
  private applyZone(t: number, zone: Zone, outcome: BlinkOutcome) {
    this.currentZone = zone;
    const index = this.optionAt(zone);

    // Dwell restarts whenever the zone changes; looking at the centre re-arms it.
    if (zone !== this.dwellZone) {
      this.dwellZone = zone;
      this.dwellStart = t;
    }
    if (zone === 'center') this.armed = true;

    let dwellProgress = 0;
    if (index !== null && this.armed && !this.settling) {
      dwellProgress = Math.min(1, (t - this.dwellStart) / this.tuning.dwellMs);
    }

    // A deliberate blink selects what you are looking at; so does a full dwell.
    if (index !== null && (outcome === 'select' || dwellProgress >= 1)) {
      this.select(index);
      dwellProgress = 0;
    }

    this.setHighlight(index, Math.max(this.blinkProgress, dwellProgress));
  }

  private onFrameVertical(
    frame: FaceFrame,
    outcome: BlinkOutcome,
    blinkProgress: number,
    settling: boolean,
  ) {
    if (outcome === 'select' && this.highlighted !== null) {
      this.emitter.emit({ type: 'select', optionIndex: this.highlighted });
    }
    const step = this.stepper.update(frame.t, frame.gaze.y, settling);
    let next = this.highlighted;
    if (step !== 0 && this.optionCount > 0) {
      next = Math.max(0, Math.min(this.optionCount - 1, (this.highlighted ?? 0) + step));
    }
    this.setHighlight(next, blinkProgress);
  }

  private select(optionIndex: number) {
    this.armed = false; // must look back at the centre before the next dwell can complete
    this.emitter.emit({ type: 'select', optionIndex });
  }

  /** Emit a `highlight` event only when something visible changed. */
  private setHighlight(index: number | null, progress: number) {
    const moved = index !== this.highlighted;
    const progressChanged =
      Math.abs(progress - this.lastProgress) >= PROGRESS_STEP ||
      (progress === 0) !== (this.lastProgress === 0);
    if (!moved && !progressChanged) return;
    this.highlighted = index;
    this.lastProgress = progress;
    this.emitter.emit({ type: 'highlight', optionIndex: index, dwellProgress: progress });
  }

  // ---- calibration ---------------------------------------------------------------------
  async calibrate(onStep?: (step: CalibrationStep) => void): Promise<string[]> {
    if (this.collector || this.calibrating) throw new Error('Calibration is already running.');
    if (this.gaze && this.mode === 'full') return this.calibrateScreen(onStep);

    const steps = this.mode === 'full' ? FULL_STEPS : VERTICAL_STEPS;
    const frames: Partial<Record<StepKey, FaceFrame[]>> = {};
    try {
      for (const [i, step] of steps.entries()) {
        onStep?.({
          target: step.target,
          prompt: step.prompt,
          seconds: step.seconds,
          index: i + 1,
          total: steps.length,
        });

        const collected: FaceFrame[] = [];
        const startedAt = performance.now();
        this.collector = (f) => {
          if (f.t - startedAt >= CALIBRATION_REACTION_MS) collected.push(f);
        };
        await new Promise((resolve) => setTimeout(resolve, step.seconds * 1000));
        this.collector = null;

        if (collected.length < MIN_CALIBRATION_FRAMES) {
          throw new Error(
            `I couldn't see the face during "${step.prompt}". Check the camera and lighting, and keep the face in view.`,
          );
        }
        frames[step.key] = collected;
      }
    } finally {
      this.collector = null;
    }

    const warnings: string[] = [];
    const medianY = (fs: FaceFrame[]) => median(fs.map((f) => f.gaze.y));
    const f = frames as Record<StepKey, FaceFrame[]>;

    // 1) which corner is which (full mode only)
    if (this.mode === 'full') {
      const samples = {} as Record<Zone, number[][]>;
      for (const z of ZONES) samples[z] = f[z].map(gazeFeatures);
      const trained = trainCornerModel(samples);
      if (!trained)
        throw new Error('Not enough usable camera frames to learn the corners. Try again.');
      this.corners.setModel(trained.model);
      this.savedModel = trained.model;
      saveCornerModel(trained.model);
      warnings.push(...trained.warnings);
      console.info(
        '[eye calibration] corner model',
        JSON.stringify({ weight: trained.model.weight, sigma: trained.model.sigma }),
      );
    }

    // 2) blink and up/down thresholds (used by vertical mode, and to detect blinks)
    // full mode: the rest band is at the top of the screen, the columns' words at the bottom
    const topY = this.mode === 'full' ? medianY(f.center) : medianY(f.up);
    const bottomY =
      this.mode === 'full'
        ? (medianY(f.left) + medianY(f.middle) + medianY(f.right)) / 3
        : medianY(f.down);
    const samples: CalibrationSamples = {
      centerY: this.mode === 'full' ? (topY + bottomY) / 2 : medianY(f.center),
      upY: topY,
      downY: bottomY,
      openBlink: median(f.center.map(blinkScore)),
      closedBlink: median(f.closed.map(blinkScore)),
    };
    console.info('[eye calibration] samples', JSON.stringify(samples));

    const result = tuningFromSamples(samples, this.tuning);
    warnings.push(...result.warnings);
    for (const w of warnings) console.warn('[eye calibration]', w);

    this.tuning = result.tuning;
    this.blink.setTuning(result.tuning);
    this.stepper.setTuning(result.tuning);
    this.corners.setHoldMs(result.tuning.regionHoldMs);
    saveTuning(result.tuning);
    return warnings;
  }

  // ---- calibration with screen gaze (WebGazer) -----------------------------------------------
  /**
   * Hands-free: a dot appears, the person looks at it, and we teach WebGazer "the eyes look like
   * THIS when looking at THAT spot" (no clicking). Then a check: dots again, and we measure how
   * often the gaze lands in the right box, which is the number that actually matters here.
   */
  private async calibrateScreen(onStep?: (step: CalibrationStep) => void): Promise<string[]> {
    const gaze = this.gaze!;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const px = (pos: { x: number; y: number }) => ({
      x: (pos.x / 100) * window.innerWidth,
      y: (pos.y / 100) * window.innerHeight,
    });
    const total = TRAIN_POINTS.length + CHECK_ZONES.length + 1;
    let n = 0;
    const step = (
      target: CalibrationStep['target'],
      prompt: string,
      seconds: number,
      position?: { x: number; y: number },
    ) => onStep?.({ target, position, prompt, seconds, index: ++n, total });

    this.calibrating = true;
    localStorage.removeItem(SCREEN_CALIBRATED_KEY);
    const bucket: { key: string; frames: FaceFrame[] }[] = [];
    let current: FaceFrame[] | null = null;
    this.collector = (f) => current?.push(f);
    const warnings: string[] = [];
    try {
      await gaze.clearTraining();

      // 1) TRAIN: look at each dot
      for (const point of TRAIN_POINTS) {
        step('point', 'Look at the dot', (SETTLE_MS + TRAIN_MS) / 1000, point.pos);
        current = [];
        await sleep(SETTLE_MS);
        const at = px(point.pos);
        for (let waited = 0; waited < TRAIN_MS; waited += TRAIN_EVERY_MS) {
          gaze.train(at.x, at.y);
          await sleep(TRAIN_EVERY_MS);
        }
        bucket.push({ key: point.key, frames: current });
        current = null;
      }

      // 2) BLINK: eyes closed
      step('closed', 'Close your eyes gently and keep them closed', 2.5);
      current = [];
      await sleep(2500);
      bucket.push({ key: 'closed', frames: current });
      current = null;

      // 3) CHECK: how often does the gaze land in the right box?
      const results: { zone: Zone; hit: number; n: number; err: number }[] = [];
      for (const zone of CHECK_ZONES) {
        const pos = TARGET_POSITION[zone];
        step(
          zone === 'center' ? 'center' : zone,
          'Look at the dot (checking accuracy)',
          (SETTLE_MS + CHECK_MS) / 1000,
        );
        await sleep(SETTLE_MS);
        const at = px(pos);
        const readings: GazePoint[] = [];
        const off = gaze.onGaze((p) => p && readings.push(p));
        await sleep(CHECK_MS);
        off();
        const vp = { w: window.innerWidth, h: window.innerHeight };
        const hit = readings.filter((r) => zoneAt(r.x, r.y, vp) === zone).length;
        const err = readings.length
          ? readings.reduce((sum, r) => sum + Math.hypot(r.x - at.x, r.y - at.y), 0) /
            readings.length
          : NaN;
        results.push({ zone, hit, n: readings.length, err });
      }
      const usable = results.filter((r) => r.n >= 5);
      if (usable.length < results.length) {
        throw new Error(
          "I couldn't get gaze readings while checking. Make sure the camera can see your face, then try again.",
        );
      }
      const overall = usable.reduce((s, r) => s + r.hit, 0) / usable.reduce((s, r) => s + r.n, 0);
      this.accuracy = overall;
      console.info(
        '[gaze calibration] accuracy',
        JSON.stringify(
          results.map((r) => ({ ...r, err: Math.round(r.err) })),
          null,
          0,
        ),
        'overall',
        overall.toFixed(2),
      );
      for (const r of results) {
        if (r.hit / r.n < 0.6) {
          warnings.push(
            `${ZONE_LABEL[r.zone]}: only ${Math.round((100 * r.hit) / r.n)}% of readings landed in the right box.`,
          );
        }
      }

      // blink + up/down thresholds, from the frames we saw along the way
      const framesOf = (keys: string[]) =>
        bucket.filter((b) => keys.includes(b.key)).flatMap((b) => b.frames);
      const open = framesOf(TRAIN_POINTS.map((p) => p.key));
      const closed = framesOf(['closed']);
      const medianY = (fs: FaceFrame[]) => median(fs.map((f) => f.gaze.y));
      if (open.length >= 10 && closed.length >= 10) {
        const result = tuningFromSamples(
          {
            centerY:
              (medianY(framesOf(['center'])) + medianY(framesOf(['left', 'middle', 'right']))) / 2,
            upY: medianY(framesOf(['center', 'rest-left', 'rest-right'])),
            downY: medianY(
              framesOf(['left', 'middle', 'right', 'col-left', 'col-middle', 'col-right']),
            ),
            openBlink: median(open.map(blinkScore)),
            closedBlink: median(closed.map(blinkScore)),
          },
          this.tuning,
        );
        // gaze up/down thresholds only matter in vertical mode; the blink ones matter here
        warnings.push(...result.warnings.filter((w) => w.startsWith('Closed')));
        this.tuning = result.tuning;
        this.blink.setTuning(result.tuning);
        this.stepper.setTuning(result.tuning);
        saveTuning(result.tuning);
      } else {
        warnings.push("I couldn't see the face well enough to learn your blink.");
      }
      localStorage.setItem(SCREEN_CALIBRATED_KEY, '1');
    } finally {
      this.collector = null;
      this.calibrating = false;
      this.zones.reset();
      this.dwellZone = null;
      this.armed = false;
    }
    for (const w of warnings) console.warn('[eye calibration]', w);
    return warnings;
  }
}
