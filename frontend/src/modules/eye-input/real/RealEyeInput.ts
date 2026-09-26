import { optionRegions } from '../../../contracts';
import type {
  CalibrationStep,
  EyeEvent,
  EyeInput,
  EyeMode,
  FaceFrame,
  FaceTracker,
} from '../../../contracts';
import { createEmitter } from '../../../core/emitter';
import { BlinkDetector } from './blink';
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

type StepKey = Zone | 'up' | 'down' | 'closed';
interface StepDef {
  key: StepKey;
  target: CalibrationStep['target'];
  prompt: string;
  seconds: number;
}

const CORNER_NAME: Record<string, string> = {
  'up-left': 'top-left',
  'up-right': 'top-right',
  'down-left': 'bottom-left',
  'down-right': 'bottom-right',
};

const FULL_STEPS: StepDef[] = [
  { key: 'center', target: 'center', prompt: 'Look at the dot in the middle', seconds: 3 },
  ...(['up-left', 'up-right', 'down-left', 'down-right'] as const).map((z) => ({
    key: z,
    target: z,
    prompt: `Look at the dot in the ${CORNER_NAME[z]} corner`,
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

  // dwell (full mode)
  private dwellZone: Zone | null = null;
  private dwellStart = 0;
  /** False after a selection / screen change, until the person looks back at the centre. */
  private armed = false;

  /** While calibrating, frames go here instead of controlling the app. */
  private collector: ((frame: FaceFrame) => void) | null = null;

  constructor(private tracker: FaceTracker) {}

  start(options: { mode: EyeMode; optionCount: number }) {
    this.unsubscribe?.();
    this.mode = options.mode;
    this.corners.reset();
    this.stepper.reset();
    this.unsubscribe = this.tracker.onFrame((frame) => this.onFrame(frame));
    this.setOptionCount(options.optionCount);
  }

  setOptionCount(optionCount: number) {
    this.optionCount = optionCount;
    this.blink.invalidate(); // a blink that began on the previous screen must not act here
    this.stepper.reset();
    this.armed = false; // no dwell-select on a fresh screen until the gaze has rested at the centre
    this.dwellZone = null;
    const index =
      this.mode === 'full' ? this.optionAt(this.corners.current) : optionCount > 0 ? 0 : null;
    this.setHighlight(index, 0);
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  on(handler: (event: EyeEvent) => void) {
    return this.emitter.on(handler);
  }

  status() {
    return {
      region: this.mode === 'full' ? this.corners.current : null,
      calibrated: this.mode === 'full' ? this.savedModel !== null : true,
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

    // Face lost for a moment: whatever gaze we were tracking is stale. Start fresh and wait
    // for the person to look at the centre again before any dwell can complete.
    if (frame.t - this.lastFrameAt > this.tuning.frameGapMs) {
      this.corners.reset();
      this.dwellZone = null;
      this.armed = false;
    }
    this.lastFrameAt = frame.t;

    const { outcome, progress: blinkProgress } = this.blink.update(frame.t, blinkScore(frame));
    if (this.blink.closed) this.blinkEndedAt = frame.t;
    // Eyes roll while closing and opening, so freeze gaze around blinks.
    const settling = this.blink.closed || frame.t - this.blinkEndedAt < this.tuning.settleMs;

    if (this.mode === 'full') this.onFrameFull(frame, outcome, blinkProgress, settling);
    else this.onFrameVertical(frame, outcome, blinkProgress, settling);

    if (outcome === 'cancel') this.emitter.emit({ type: 'cancel' });
  }

  private onFrameFull(
    frame: FaceFrame,
    outcome: 'select' | 'cancel' | null,
    blinkProgress: number,
    settling: boolean,
  ) {
    const t = frame.t;
    const zone = this.corners.update(t, gazeFeatures(frame), settling);
    const index = this.optionAt(zone);

    // Dwell restarts whenever the zone changes; looking at the centre re-arms it.
    if (zone !== this.dwellZone) {
      this.dwellZone = zone;
      this.dwellStart = t;
    }
    if (zone === 'center') this.armed = true;

    let dwellProgress = 0;
    if (index !== null && this.armed && !settling) {
      dwellProgress = Math.min(1, (t - this.dwellStart) / this.tuning.dwellMs);
    }

    // A deliberate blink selects what you are looking at; so does a full dwell.
    if (index !== null && (outcome === 'select' || dwellProgress >= 1)) {
      this.select(index);
      dwellProgress = 0;
    }

    this.setHighlight(index, Math.max(blinkProgress, dwellProgress));
  }

  private onFrameVertical(
    frame: FaceFrame,
    outcome: 'select' | 'cancel' | null,
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
    if (this.collector) throw new Error('Calibration is already running.');

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
    const topY =
      this.mode === 'full' ? (medianY(f['up-left']) + medianY(f['up-right'])) / 2 : medianY(f.up);
    const bottomY =
      this.mode === 'full'
        ? (medianY(f['down-left']) + medianY(f['down-right'])) / 2
        : medianY(f.down);
    const samples: CalibrationSamples = {
      centerY: medianY(f.center),
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
}
