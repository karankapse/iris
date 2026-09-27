import type { GazePoint, ScreenGaze } from '../../contracts';
import { createEmitter } from '../emitter';
import type { EyeFeatureSource } from './FilteredGaze';

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
 *  - Out of the box its regression only REMEMBERS THE LAST 50 TRAINING SAMPLES (a ring buffer in
 *    util_regression.mjs). Calibration records ~16 samples per dot, so by the end it had forgotten
 *    all but the last 3 dots: it followed the dot nicely while training (it had just learned that
 *    spot) and then fell apart in the check round. We enlarge that memory (see widenMemory).
 *  - WebGazer only saves training that came from real mouse clicks, not from recordScreenPosition()
 *    (what we use), so its training does NOT survive a page reload.
 */
export class WebGazerGaze implements ScreenGaze, EyeFeatureSource {
  private emitter = createEmitter<GazePoint | null>();
  private lib: NonNullable<Window['webgazer']> | null = null;
  /** Bumped by every start()/stop() so a slow start() can tell it has been cancelled. */
  private generation = 0;
  private latestFeatures: { f: number[]; t: number } | null = null;

  async start() {
    if (this.lib) return;
    const generation = ++this.generation;

    await loadScript(WEBGAZER_SCRIPT);
    const webgazer = window.webgazer;
    if (!webgazer) throw new Error('WebGazer loaded but did not start. Reload the page.');
    if (generation !== this.generation) return;

    // Serve WebGazer's face model from our own server (`npm run setup:mediapipe` copies it),
    // so nothing is fetched from a CDN.
    webgazer.params.faceMeshSolutionPath = '/webgazer/face_mesh';
    webgazer
      .setRegression('ridge')
      .saveDataAcrossSessions(true)
      // Off: FilteredGaze applies a One Euro filter instead (less lag when the eyes jump).
      .applyKalmanFilter(false)
      // We draw our own UI: hide WebGazer's video, face overlay and dot.
      .showVideo(false)
      .showVideoPreview(false)
      .showFaceOverlay(false)
      .showFaceFeedbackBox(false)
      .showPredictionPoints(false)
      .setGazeListener((data) => {
        const t = performance.now();
        this.latestFeatures = data ? eyeFeatures(webgazer, data.eyeFeatures, t) : null;
        this.emitter.emit(data ? { x: data.x, y: data.y, t } : null);
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
    widenMemory(webgazer);
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

  /**
   * The eye-patch features WebGazer predicted the latest point from (120 numbers: both eyes'
   * patches resized to 10x6 grey pixels, histogram-equalised). FilteredGaze learns its own,
   * cross-validated regression from these (see ridge.ts).
   */
  eyeFeatures() {
    return this.latestFeatures;
  }

  train(x: number, y: number) {
    this.lib?.recordScreenPosition(x, y, 'click');
  }

  async clearTraining() {
    if (!this.lib) return;
    await this.lib.clearData();
    widenMemory(this.lib); // clearData() re-creates the regression with its default 50-sample memory
  }
}

/**
 * How many training samples WebGazer's ridge regression keeps (its default is 50). It re-solves the
 * regression on every frame over all of them, so this costs time: measured ~1.5 ms per frame at 50,
 * ~6 ms at 300 (Node on an M-series Mac). 300 holds a whole calibration pass (13 dots x ~16).
 */
export const WEBGAZER_MEMORY = 300;

/** The ring buffers WebGazer keeps its click (= training) data in. */
const CLICK_WINDOWS = [
  'screenXClicksArray',
  'screenYClicksArray',
  'eyeFeaturesClicks',
  'dataClicks',
] as const;

/**
 * Let WebGazer's regression remember WEBGAZER_MEMORY training samples instead of 50. Its buffers
 * (util.DataWindow) only grow while `data.length < windowSize`, so raising `windowSize` on the
 * (still empty or partly filled) buffers is enough. Anything unexpected is left alone.
 */
export function widenMemory(lib: Pick<WebGazerApi, 'getRegression'>, size = WEBGAZER_MEMORY) {
  let regs: unknown[];
  try {
    regs = lib.getRegression?.() ?? [];
  } catch {
    return;
  }
  for (const reg of regs) {
    for (const key of CLICK_WINDOWS) {
      const w = (reg as Record<string, unknown> | null)?.[key] as
        { windowSize?: unknown; data?: unknown } | undefined;
      if (w && typeof w.windowSize === 'number' && Array.isArray(w.data) && w.windowSize < size) {
        w.windowSize = size;
      }
    }
  }
}

const WEBGAZER_SCRIPT = '/webgazer/webgazer.js';

/** WebGazer's feature vector for a frame's eye patches, or null if unavailable. */
export function eyeFeatures(
  lib: Pick<WebGazerApi, 'util'>,
  eyes: unknown,
  t: number,
): { f: number[]; t: number } | null {
  if (!eyes || typeof lib.util?.getEyeFeats !== 'function') return null;
  try {
    const f = lib.util.getEyeFeats(eyes);
    return Array.isArray(f) && f.length > 0 && f.every(Number.isFinite) ? { f: [...f], t } : null;
  } catch {
    return null; // e.g. an eye patch of size 0 when the face is at the edge of the image
  }
}

/**
 * Load a classic script. WebGazer is loaded this way (not imported) on purpose: its face-model
 * code relies on a top-level `this` that a bundler would turn into `undefined`, which breaks it
 * with "(void 0) is not a constructor".
 */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.webgazer) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () =>
      reject(new Error(`Could not load ${src}. Run "cd frontend && npm run setup:mediapipe".`));
    document.head.appendChild(el);
  });
}

function describe(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotAllowedError') {
    return 'Camera permission was denied for gaze tracking. Allow the camera and reload.';
  }
  if (e instanceof DOMException && e.name === 'NotFoundError')
    return 'No camera found for gaze tracking.';
  return `Could not start gaze tracking: ${e instanceof Error ? e.message : String(e)}`;
}
