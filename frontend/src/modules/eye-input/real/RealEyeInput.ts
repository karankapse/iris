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
import { GazeStepper } from './gaze';
import {
  loadTuning,
  median,
  saveTuning,
  tuningFromSamples,
  type CalibrationSamples,
  type EyeTuning,
} from './tuning';

/** How the user controls the app with their eyes (same events as the keyboard mock):
 *
 *   look UP / DOWN and hold   -> move the highlight (one option at a time)
 *   deliberate blink (~0.5 s) -> `select` the highlighted option
 *   keep eyes closed (~1.5 s) -> `cancel` (go back)
 *
 * Both modes use only up/down gaze and blinks, so 'vertical' (for users who can't move their
 * eyes sideways) and 'full' currently behave the same. Sideways gaze is reserved for later.
 */

const BLINK_KEYS = ['eyeBlinkLeft', 'eyeBlinkRight'] as const;
/** Skip the first part of each calibration step: people need a moment to react. */
const CALIBRATION_REACTION_MS = 800;
const MIN_CALIBRATION_FRAMES = 5;
const PROGRESS_STEP = 0.05;

const CALIBRATION_STEPS = [
  { key: 'center', prompt: 'Look straight at the middle of the screen', seconds: 3 },
  { key: 'up', prompt: 'Look UP, toward the top of the screen', seconds: 3 },
  { key: 'down', prompt: 'Look DOWN, toward the bottom of the screen', seconds: 3 },
  { key: 'closed', prompt: 'Close your eyes gently and keep them closed', seconds: 2.5 },
] as const;

/** 0 (open) .. 1 (closed). Average of both eyes so a face that can't close one eye fully still works. */
export function blinkScore(frame: FaceFrame): number {
  return BLINK_KEYS.reduce((sum, k) => sum + (frame.blendshapes[k] ?? 0), 0) / BLINK_KEYS.length;
}

export class RealEyeInput implements EyeInput {
  private emitter = createEmitter<EyeEvent>();
  private tuning: EyeTuning = loadTuning();
  private blink = new BlinkDetector(this.tuning);
  private gaze = new GazeStepper(this.tuning);

  private unsubscribe: (() => void) | null = null;
  private optionCount = 0;
  private highlighted: number | null = null;
  private lastProgress = 0;
  private blinkEndedAt = -Infinity;
  /** While calibrating, frames go here instead of controlling the app. */
  private collector: ((frame: FaceFrame) => void) | null = null;

  constructor(private tracker: FaceTracker) {}

  // `mode` is accepted for the contract; see the note at the top of this file.
  start(options: { mode: EyeMode; optionCount: number }) {
    this.unsubscribe?.();
    this.unsubscribe = this.tracker.onFrame((frame) => this.onFrame(frame));
    this.setOptionCount(options.optionCount);
  }

  setOptionCount(optionCount: number) {
    this.optionCount = optionCount;
    this.blink.invalidate(); // a blink that began on the previous screen must not act here
    this.gaze.reset();
    this.setHighlight(optionCount > 0 ? 0 : null, 0);
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  on(handler: (event: EyeEvent) => void) {
    return this.emitter.on(handler);
  }

  // ---- per-frame control ------------------------------------------------------------
  private onFrame(frame: FaceFrame) {
    if (this.collector) return this.collector(frame);

    const score = blinkScore(frame);
    const { outcome, progress } = this.blink.update(frame.t, score);
    if (this.blink.closed) this.blinkEndedAt = frame.t; // "recently closed": see settleMs below

    if (outcome === 'select' && this.highlighted !== null) {
      this.emitter.emit({ type: 'select', optionIndex: this.highlighted });
    } else if (outcome === 'cancel') {
      this.emitter.emit({ type: 'cancel' });
    }

    // Eyes roll while closing and opening, so ignore gaze around blinks.
    const settling = this.blink.closed || frame.t - this.blinkEndedAt < this.tuning.settleMs;
    const step = this.gaze.update(frame.t, frame.gaze.y, settling);
    let next = this.highlighted;
    if (step !== 0 && this.optionCount > 0) {
      next = Math.max(0, Math.min(this.optionCount - 1, (this.highlighted ?? 0) + step));
    }

    this.setHighlight(next, progress);
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
  async calibrate(onStep?: (step: CalibrationStep) => void) {
    if (this.collector) throw new Error('Calibration is already running.');

    const medians: Record<string, { gazeY: number; blink: number }> = {};
    try {
      for (const [i, step] of CALIBRATION_STEPS.entries()) {
        onStep?.({
          prompt: step.prompt,
          seconds: step.seconds,
          index: i + 1,
          total: CALIBRATION_STEPS.length,
        });

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
          gazeY: median(frames.map((f) => f.gaze.y)),
          blink: median(frames.map(blinkScore)),
        };
      }
    } finally {
      this.collector = null;
    }

    const samples: CalibrationSamples = {
      centerY: medians.center.gazeY,
      upY: medians.up.gazeY,
      downY: medians.down.gazeY,
      openBlink: medians.center.blink,
      closedBlink: medians.closed.blink,
    };
    const { tuning, warnings } = tuningFromSamples(samples, this.tuning);
    for (const w of warnings) console.warn('[eye calibration]', w);

    this.tuning = tuning;
    this.blink.setTuning(tuning);
    this.gaze.setTuning(tuning);
    saveTuning(tuning);
  }
}
