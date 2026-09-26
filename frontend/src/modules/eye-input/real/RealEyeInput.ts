import type { EyeEvent, EyeInput, EyeMode, FaceTracker } from '../../../contracts';
import { createEmitter } from '../../../core/emitter';

/**
 * TODO(Module 1 owner): the real webcam-based EyeInput. Everything below is a skeleton.
 *
 * What you get: `tracker.onFrame(frame)` gives you, ~30x per second,
 *   - frame.gaze         rough iris-based direction, -1..1 per axis (uncalibrated)
 *   - frame.blendshapes  e.g. eyeBlinkLeft / eyeBlinkRight (0 = open, 1 = closed)
 *
 * What you must produce: EyeEvents (see contracts/eye.ts), same as MockEyeInput:
 *   highlight -> select (dwell finished or deliberate blink) -> confirm / cancel
 *
 * Suggested build order (each is a starter issue):
 *   1. blink detection: closed for > ~400 ms = deliberate, shorter = natural blink, ignore it
 *   2. gaze region classification (left/right/up/down) using calibration thresholds
 *   3. dwell selection with progress (`dwellProgress` 0..1 in `highlight` events)
 *   4. 'vertical' mode: up/down + blinks only
 *   5. calibrate(): guided look-at-each-target + a deliberate-blink test
 */
export class RealEyeInput implements EyeInput {
  private emitter = createEmitter<EyeEvent>();
  private unsubscribe: (() => void) | null = null;

  constructor(private tracker: FaceTracker) {}

  start(_options: { mode: EyeMode; optionCount: number }) {
    this.unsubscribe = this.tracker.onFrame(() => {
      // TODO: turn frames into EyeEvents and call this.emitter.emit(...)
    });
    throw new Error(
      'RealEyeInput is not implemented yet. Set VITE_MOCK_EYE=1 (or remove it) to use the keyboard mock.',
    );
  }

  setOptionCount(_optionCount: number) {
    // TODO
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async calibrate() {
    throw new Error('Calibration is not implemented yet.');
  }

  on(handler: (event: EyeEvent) => void) {
    return this.emitter.on(handler);
  }
}
