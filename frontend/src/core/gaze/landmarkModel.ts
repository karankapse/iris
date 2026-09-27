// A second, independent gaze estimate from the MediaPipe face landmarks: where the iris sits in
// each eye (measured along the eye's own axis, so head tilt and distance don't matter) plus
// MediaPipe's eye-rotation blendshapes, mapped to SCREEN pixels by a small per-person regression
// learned during calibration. Iris position is a strong left/right signal, and its errors are
// unrelated to WebGazer's, so combining the two is more accurate than either alone.
//
// Want to plug in another gaze model (e.g. an open-source CNN that outputs eye yaw/pitch)?
// Put its per-frame outputs in `frame.metrics` and add their names to BASE_FEATURES: calibration
// learns how they map to the screen, and the fusion weights them by how accurate they measure.
import type { FaceFrame } from '../../contracts';
import { fitRidge, predictRidge, type RidgeFit, type RidgeModel, type RidgeSample } from './ridge';

/** Metrics used as-is. Head pose is left out on purpose: FilteredGaze compensates it separately. */
const BASE_FEATURES = ['irisX', 'irisY'] as const;

/**
 * The feature vector for one frame, or null if the frame has no iris data (e.g. the mock
 * tracker). Adds MediaPipe's gaze blendshapes and the iris' squared/cross terms, so the mapping
 * can bend a little near the screen edges.
 */
export function landmarkFeatures(frame: FaceFrame): number[] | null {
  const base = BASE_FEATURES.map((k) => frame.metrics[k]);
  if (base.some((v) => v === undefined || !Number.isFinite(v))) return null;
  const [ix, iy] = base as number[];
  return [...(base as number[]), frame.gaze.x, frame.gaze.y, ix * ix, iy * iy, ix * iy];
}

export type LandmarkSample = RidgeSample;
export type LandmarkModel = RidgeModel;

const LAMBDAS = [0.03, 0.3, 3, 30, 300];
const MIN_GROUPS = 6;
const MIN_SAMPLES = 40;

/**
 * Ridge regression from features to screen x and y. The amount of regularisation is chosen per
 * axis by leave-one-dot-out cross-validation: train on all dots but one, test on that one.
 * Returns the model with its held-out predictions, or null if it is no better than always
 * guessing the middle of the dots.
 */
export function fitLandmarkRidge(samples: LandmarkSample[]): RidgeFit | null {
  const fit = fitRidge(samples, {
    lambdas: LAMBDAS,
    minGroups: MIN_GROUPS,
    minSamples: MIN_SAMPLES,
  });
  return fit && !useless(fit, samples) ? fit : null;
}

export function fitLandmarkModel(samples: LandmarkSample[]): LandmarkModel | null {
  return fitLandmarkRidge(samples)?.model ?? null;
}

/** No better than always guessing the middle of the dots, on both axes? */
export function useless(fit: RidgeFit, samples: { x: number; y: number }[]) {
  const spread = (v: number[]) => Math.sqrt(avg(v.map((x) => (x - avg(v)) ** 2)));
  return (
    fit.model.errX > 0.9 * spread(samples.map((s) => s.x)) &&
    fit.model.errY > 0.9 * spread(samples.map((s) => s.y))
  );
}

export const predictLandmark = predictRidge;

const avg = (v: number[]) => v.reduce((s, x) => s + x, 0) / (v.length || 1);
