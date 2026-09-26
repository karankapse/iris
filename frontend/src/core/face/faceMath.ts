// Pure maths on MediaPipe output. Kept out of the tracker class so it can be unit-tested
// without a camera.
import type { Point } from '../../contracts';

const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));

/**
 * Mouth asymmetry, ported from Srihith's demo (face/face.html): how much higher one mouth
 * corner sits than the other, relative to face height. 0 = level; the sign says which side
 * is higher. Landmarks: 61/291 mouth corners, 33/263 outer eye corners, 10/152 forehead/chin.
 */
export function mouthAsymmetry(L: Point[]): number {
  const mouthL = L[61];
  const mouthR = L[291];
  const eyeMid = (L[33].y + L[263].y) / 2;
  const faceH = Math.abs(L[10].y - L[152].y);
  if (!faceH) return 0;
  return (mouthL.y - eyeMid - (mouthR.y - eyeMid)) / faceH;
}

/**
 * Gaze from MediaPipe's own `eyeLook*` blendshapes (the model estimates eye rotation for us,
 * which is more reliable than measuring the iris ourselves).
 *   y: -1 up ... +1 down.     x: -1 left ... +1 right (sign not yet verified on a real camera).
 */
export function estimateGaze(b: Record<string, number>): { x: number; y: number } {
  const v = (name: string) => b[name] ?? 0;
  const up = (v('eyeLookUpLeft') + v('eyeLookUpRight')) / 2;
  const down = (v('eyeLookDownLeft') + v('eyeLookDownRight')) / 2;
  const lookLeft = (v('eyeLookOutLeft') + v('eyeLookInRight')) / 2;
  const lookRight = (v('eyeLookInLeft') + v('eyeLookOutRight')) / 2;
  return { x: clamp(lookRight - lookLeft), y: clamp(down - up) };
}

/** Head rotation (degrees) from MediaPipe's 4x4 column-major transformation matrix. */
export function headPoseFromMatrix(m?: ArrayLike<number>) {
  if (!m) return { yaw: 0, pitch: 0, roll: 0 };
  const deg = 180 / Math.PI;
  return {
    pitch: Math.asin(-clamp(m[9])) * deg,
    yaw: Math.atan2(m[8], m[10]) * deg,
    roll: Math.atan2(m[1], m[5]) * deg,
  };
}
