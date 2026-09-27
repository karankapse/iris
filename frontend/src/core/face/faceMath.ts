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

/**
 * Where the iris sits inside each eye, from the iris landmarks (468-477) and the eye corners.
 * This is a second, geometric estimate of gaze, independent from MediaPipe's blendshape one.
 * Both are measured in eye-widths, averaged over both eyes:
 *   irisX: + means the iris is toward the RIGHT of the camera image (the user's left)
 *   irisY: + means the iris is toward the BOTTOM of the eye
 * (The signs don't matter: calibration learns what each corner looks like for this person.)
 */
const EYES = [
  { outer: 33, inner: 133, top: 159, bottom: 145, iris: 468 }, // user's right eye (image left)
  { outer: 263, inner: 362, top: 386, bottom: 374, iris: 473 }, // user's left eye (image right)
] as const;

export function irisMetrics(L: Point[], aspect = 1): { irisX: number; irisY: number } {
  if (L.length < 478) return { irisX: 0, irisY: 0 }; // no iris landmarks in this result
  let dx = 0;
  let dy = 0;
  for (const e of EYES) {
    // Measure along the eye's own axis (corner to corner), so a head tilt (roll) doesn't move
    // the numbers, and divide by the eye's width, so distance to the camera doesn't either.
    const a = px(L[e.outer], aspect);
    const b = px(L[e.inner], aspect);
    let ux = b.x - a.x;
    let uy = b.y - a.y;
    if (ux < 0) [ux, uy] = [-ux, -uy]; // always point image-right, whichever corner is which
    const width = Math.hypot(ux, uy) || 1e-6;
    ux /= width;
    uy /= width;
    const iris = px(L[e.iris], aspect);
    const vx = iris.x - (a.x + b.x) / 2;
    const vy = iris.y - (a.y + b.y) / 2;
    dx += (vx * ux + vy * uy) / width; // along the eye: + = toward image right
    dy += (vx * -uy + vy * ux) / width; // across the eye: + = toward the bottom
  }
  return { irisX: dx / EYES.length, irisY: dy / EYES.length };
}

/** Landmark in square units: x is scaled by the image aspect (width / height). */
const px = (p: Point, aspect: number) => ({ x: p.x * aspect, y: p.y });

/**
 * Eye Aspect Ratio (Soukupová & Čech, 2016): eyelid opening divided by eye width, averaged over
 * both eyes. About 0.25-0.35 open, under ~0.1 closed; the exact numbers differ per face, so
 * calibration measures this person's open and closed values. 0 = no landmarks.
 *   EAR = (|p2 - p6| + |p3 - p5|) / (2 |p1 - p4|)
 */
const EAR_POINTS = [
  [33, 160, 158, 133, 153, 144], // user's right eye: p1..p6
  [362, 385, 387, 263, 373, 380], // user's left eye
] as const;

export function eyeAspectRatio(L: Point[], aspect = 1): number {
  if (L.length < 388) return 0;
  const d = (i: number, j: number) => {
    const a = px(L[i], aspect);
    const b = px(L[j], aspect);
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  let sum = 0;
  for (const [p1, p2, p3, p4, p5, p6] of EAR_POINTS) {
    sum += (d(p2, p6) + d(p3, p5)) / (2 * (d(p1, p4) || 1e-6));
  }
  return sum / EAR_POINTS.length;
}
