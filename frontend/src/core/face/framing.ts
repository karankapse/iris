// Auto-framing for the camera preview: crop the video to the face so the eyes are big and
// easy to see, and follow the face as it moves. Pure maths, so it is tested without a camera.
import type { Point } from '../../contracts';

export interface Crop {
  /** In video pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The whole frame, cropped to the preview's aspect ratio and centred (used when no face is seen). */
export function fullCrop(videoW: number, videoH: number, aspect: number): Crop {
  let w = videoW;
  let h = w / aspect;
  if (h > videoH) {
    h = videoH;
    w = h * aspect;
  }
  return { x: (videoW - w) / 2, y: (videoH - h) / 2, w, h };
}

/**
 * A crop around the face. `zoom` is how much wider than the face the crop is (1.5 = the face
 * fills about two thirds of the width). The crop is centred slightly ABOVE the middle of the
 * face, where the eyes are, and always tall enough to include the whole chin and forehead.
 */
export function faceCrop(
  landmarks: Point[],
  videoW: number,
  videoH: number,
  aspect: number,
  zoom = 1.6,
): Crop {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of landmarks) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const faceW = (maxX - minX) * videoW;
  const faceH = (maxY - minY) * videoH;
  if (!(faceW > 0 && faceH > 0)) return fullCrop(videoW, videoH, aspect);

  let w = faceW * zoom;
  let h = w / aspect;
  if (h < faceH * 1.25) {
    // a tall face: make the crop taller so the whole face still fits
    h = faceH * 1.25;
    w = h * aspect;
  }
  // never bigger than the video itself
  const shrink = Math.min(1, videoW / w, videoH / h);
  w *= shrink;
  h *= shrink;

  const cx = ((minX + maxX) / 2) * videoW;
  const cy = (minY + (maxY - minY) * 0.42) * videoH; // eyes sit about 40% down the face
  return {
    x: Math.min(Math.max(0, cx - w / 2), videoW - w),
    y: Math.min(Math.max(0, cy - h / 2), videoH - h),
    w,
    h,
  };
}

/** Move `from` a fraction `k` (0..1) of the way toward `to`: smooth camera motion. */
export function lerpCrop(from: Crop, to: Crop, k: number): Crop {
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    w: from.w + (to.w - from.w) * k,
    h: from.h + (to.h - from.h) * k,
  };
}
