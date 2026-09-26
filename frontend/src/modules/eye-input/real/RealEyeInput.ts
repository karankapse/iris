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
import { GazeStepper, RegionTracker } from './gaze';
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
 * Options are shown at up to 4 screen positions: top, right, bottom, left (see `optionRegions`).
 *
 * FULL mode (all four directions):
 *   look at an option        -> it is highlighted
 *   keep looking (dwell)     -> a bar fills; when full, the option is SELECTED
 *   blink deliberately       -> selects the highlighted option immediately (faster than dwell)
 *   look at the centre       -> rest: nothing is highlighted and dwell restarts
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
/** Skip the first part of each calibration step: people need a moment to react. */
const CALIBRATION_REACTION_MS = 800;
const MIN_CALIBRATION_FRAMES = 5;
const PROGRESS_STEP = 0.05;

type StepKey = 'center' | 'left' | 'right' | 'up' | 'down' | 'closed';
const CALIBRATION_STEPS: { key: StepKey; prompt: string; seconds: number; sideways: boolean }[] = [
  {
    key: 'center',
    prompt: 'Look straight at the middle of the screen',
    seconds: 3,
    sideways: false,
  },
  {
    key: 'left',
    prompt: 'Look LEFT, toward the left edge of the screen',
    seconds: 3,
    sideways: true,
  },
  {
    key: 'right',
    prompt: 'Look RIGHT, toward the right edge of the screen',
    seconds: 3,
    sideways: true,
  },
  { key: 'up', prompt: 'Look UP, toward the top of the screen', seconds: 3, sideways: false },
  {
    key: 'down',
    prompt: 'Look DOWN, toward the bottom of the screen',
    seconds: 3,
    sideways: false,
  },
  {
    key: 'closed',
    prompt: 'Close your eyes gently and keep them closed',
    seconds: 2.5,
    sideways: false,
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
  private regions = new RegionTracker(this.tuning); // full mode

  private unsubscribe: (() => void) | null = null;
  private mode: EyeMode = 'full';
  private optionCount = 0;
  private highlighted: number | null = null;
  private lastProgress = 0;
  private blinkEndedAt = -Infinity;
  private lastFrameAt = -Infinity;

  // dwell (full mode)
  private dwellRegion: string | null = null;
  private dwellStart = 0;
  /** False after a selection / screen change, until the person looks back at the centre. */
  private armed = false;

  /** While calibrating, frames go here instead of controlling the app. */
  private collector: ((frame: FaceFrame) => void) | null = null;

  constructor(private tracker: FaceTracker) {}

  start(options: { mode: EyeMode; optionCount: number }) {
    this.unsubscribe?.();
    this.mode = options.mode;
    this.regions.reset();
    this.stepper.reset();
    this.unsubscribe = this.tracker.onFrame((frame) => this.onFrame(frame));
    this.setOptionCount(options.optionCount);
  }

  setOptionCount(optionCount: number) {
    this.optionCount = optionCount;
    this.blink.invalidate(); // a blink that began on the previous screen must not act here
    this.stepper.reset();
    this.armed = false; // no dwell-select on a fresh screen until the gaze has rested at the centre
    this.dwellRegion = null;
    const index =
      this.mode === 'full' ? this.optionAt(this.regions.current) : optionCount > 0 ? 0 : null;
    this.setHighlight(index, 0);
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  on(handler: (event: EyeEvent) => void) {
    return this.emitter.on(handler);
  }

  /** The option that sits in `region` on the current screen (full mode), if any. */
  private optionAt(region: string): number | null {
    const index = optionRegions(this.optionCount, 'full').indexOf(region as never);
    return index === -1 ? null : index;
  }

  // ---- per-frame control ------------------------------------------------------------
  private onFrame(frame: FaceFrame) {
    if (this.collector) return this.collector(frame);

    // Face lost for a moment: whatever gaze we were tracking is stale. Start fresh and wait
    // for the person to look at the centre again before any dwell can complete.
    if (frame.t - this.lastFrameAt > this.tuning.frameGapMs) {
      this.regions.reset();
      this.dwellRegion = null;
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
    const region = this.regions.update(t, frame.gaze.x, frame.gaze.y, settling, true);
    const index = region === 'center' ? null : this.optionAt(region);

    // Dwell restarts whenever the region changes; looking at the centre re-arms it.
    if (region !== this.dwellRegion) {
      this.dwellRegion = region;
      this.dwellStart = t;
    }
    if (region === 'center') this.armed = true;

    let dwellProgress = 0;
    if (index !== null && this.armed && !settling) {
      dwellProgress = Math.min(1, (t - this.dwellStart) / this.tuning.dwellMs);
    }

    // A deliberate blink selects what you are looking at; so does a full dwell.
    if (index !== null && outcome === 'select') {
      this.select(index);
      dwellProgress = 0;
    } else if (index !== null && dwellProgress >= 1) {
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

    // Vertical-only users skip the sideways steps.
    const steps = CALIBRATION_STEPS.filter((s) => this.mode === 'full' || !s.sideways);
    const medians: Partial<Record<StepKey, { x: number; y: number; blink: number }>> = {};
    try {
      for (const [i, step] of steps.entries()) {
        onStep?.({ prompt: step.prompt, seconds: step.seconds, index: i + 1, total: steps.length });

        const frames: FaceFrame[] = [];
        const startedAt = performance.now();
        this.collector = (f) => {
          if (f.t - startedAt >= CALIBRATION_REACTION_MS) frames.push(f);
        };
        await new Promise((resolve) => setTimeout(resolve, step.seconds * 1000));
        this.collector = null;

        if (frames.length < MIN_CALIBRATION_FRAMES) {
          throw new Error(
            `I couldn't see the face during "${step.prompt}". Check the camera and lighting, and keep the face in view.`,
          );
        }
        medians[step.key] = {
          x: median(frames.map((f) => f.gaze.x)),
          y: median(frames.map((f) => f.gaze.y)),
          blink: median(frames.map(blinkScore)),
        };
      }
    } finally {
      this.collector = null;
    }

    const m = medians;
    const samples: CalibrationSamples = {
      centerY: m.center!.y,
      upY: m.up!.y,
      downY: m.down!.y,
      centerX: m.center!.x,
      leftX: m.left?.x,
      rightX: m.right?.x,
      openBlink: m.center!.blink,
      closedBlink: m.closed!.blink,
    };
    // The raw numbers, so a weak result can be understood (they show up in the dev server log).
    console.info('[eye calibration] samples', JSON.stringify(samples));

    const { tuning, warnings } = tuningFromSamples(samples, this.tuning);
    for (const w of warnings) console.warn('[eye calibration]', w);
    console.info('[eye calibration] tuning', JSON.stringify(tuning));

    this.tuning = tuning;
    this.blink.setTuning(tuning);
    this.stepper.setTuning(tuning);
    this.regions.setTuning(tuning);
    saveTuning(tuning);
    return warnings;
  }
}
