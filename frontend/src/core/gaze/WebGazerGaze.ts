import type { GazePoint, ScreenGaze } from '../../contracts';
import { createEmitter } from '../emitter';

/**
 * Screen gaze from WebGazer (Brown University): it finds the eyes with a face model, and learns
 * a regression from the eye images to SCREEN COORDINATES, trained by looking at dots (see
 * RealEyeInput.calibrate). It runs entirely in the browser: no video leaves the machine.
 *
 * Notes:
 *  - WebGazer is GPL-3.0 licensed and no longer maintained (works as-is).
 *  - It opens its own camera stream, alongside the one MediaPipe uses for blinks and emotion.
 *  - It learns from the mouse by default (it assumes you look at the cursor). We switch that off:
 *    people using Iris are not necessarily looking at their mouse, and would corrupt the training.
 *  - What it learned is saved in the browser (IndexedDB) as small numeric eye-patch features, so
 *    calibration survives a page reload. Nothing is uploaded.
 */
export class WebGazerGaze implements ScreenGaze {
  private emitter = createEmitter<GazePoint | null>();
  private lib: typeof import('webgazer').default | null = null;
  /** Bumped by every start()/stop() so a slow start() can tell it has been cancelled. */
  private generation = 0;

  async start() {
    if (this.lib) return;
    const generation = ++this.generation;

    const mod = await import('webgazer');
    const webgazer = mod.default;
    if (generation !== this.generation) return;

    // Serve WebGazer's face model from our own server (`npm run setup:mediapipe` copies it),
    // so nothing is fetched from a CDN.
    webgazer.params.faceMeshSolutionPath = '/webgazer/face_mesh';
    webgazer
      .setRegression('ridge')
      .saveDataAcrossSessions(true)
      .applyKalmanFilter(true)
      // We draw our own UI: hide WebGazer's video, face overlay and dot.
      .showVideo(false)
      .showVideoPreview(false)
      .showFaceOverlay(false)
      .showFaceFeedbackBox(false)
      .showPredictionPoints(false)
      .setGazeListener((data) => {
        this.emitter.emit(data ? { x: data.x, y: data.y, t: performance.now() } : null);
      });

    try {
      await webgazer.begin();
    } catch (e) {
      throw new Error(describe(e), { cause: e });
    }
    if (generation !== this.generation) {
      webgazer.end();
      return;
    }
    webgazer.removeMouseEventListeners(); // train only from calibration, never from the mouse
    this.lib = webgazer;
  }

  stop() {
    this.generation++;
    this.lib?.clearGazeListener();
    this.lib?.end(); // releases the camera
    this.lib = null;
  }

  onGaze(handler: (point: GazePoint | null) => void) {
    return this.emitter.on(handler);
  }

  train(x: number, y: number) {
    this.lib?.recordScreenPosition(x, y, 'click');
  }

  async clearTraining() {
    await this.lib?.clearData();
  }
}

function describe(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotAllowedError') {
    return 'Camera permission was denied for gaze tracking. Allow the camera and reload.';
  }
  if (e instanceof DOMException && e.name === 'NotFoundError')
    return 'No camera found for gaze tracking.';
  return `Could not start gaze tracking: ${e instanceof Error ? e.message : String(e)}`;
}
