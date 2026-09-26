import type { FaceFrame } from '../../contracts';

/**
 * Which MediaPipe blendshapes we feed the classifier, in a FIXED order.
 * We deliberately leave out blink blendshapes (`eyeBlink*`): blinks are the user's control
 * signal in Module 1, so they must not change the guessed emotion.
 * The backend stores these names next to every sample, so if you change this list old
 * samples are ignored (the trainer only uses samples with the newest layout).
 */
export const FEATURE_NAMES = [
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthPucker',
  'jawOpen',
  'cheekSquintLeft',
  'cheekSquintRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'eyeWideLeft',
  'eyeWideRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'browDownLeft',
  'browDownRight',
  'noseSneerLeft',
  'noseSneerRight',
] as const;

/** Turn a camera frame into the numeric vector the classifier uses. Missing shapes count as 0. */
export function extractFeatures(frame: FaceFrame): number[] {
  return FEATURE_NAMES.map((name) => frame.blendshapes[name] ?? 0);
}

/** Pick at most `max` frames, evenly spread (a 3 s recording at 30 fps is 90 near-identical frames). */
export function subsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, i) => items[Math.floor((i * items.length) / max)]);
}
