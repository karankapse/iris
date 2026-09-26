import { describe, expect, it } from 'vitest';
import type { Point } from '../../contracts';
import { faceCrop, fullCrop, lerpCrop } from './framing';

/** A "face": landmarks spread over a normalised box. */
const face = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y1 },
  { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
];
const W = 1280;
const H = 720;
const ASPECT = 4 / 3;

describe('faceCrop', () => {
  it('has the preview aspect ratio and is centred on a centred face', () => {
    const c = faceCrop(face(0.4, 0.3, 0.6, 0.7), W, H, ASPECT);
    expect(c.w / c.h).toBeCloseTo(ASPECT);
    expect(c.x + c.w / 2).toBeCloseTo(0.5 * W, 0);
  });

  it('zooms in: the crop is much smaller than the frame, and the face fills a good part of it', () => {
    const c = faceCrop(face(0.4, 0.3, 0.6, 0.7), W, H, ASPECT);
    expect(c.w).toBeLessThan(W * 0.5);
    const faceW = 0.2 * W;
    expect(faceW / c.w).toBeGreaterThan(0.5);
  });

  it('always contains the whole face', () => {
    const c = faceCrop(face(0.4, 0.2, 0.6, 0.8), W, H, ASPECT);
    expect(c.y).toBeLessThanOrEqual(0.2 * H);
    expect(c.y + c.h).toBeGreaterThanOrEqual(0.8 * H);
    expect(c.x).toBeLessThanOrEqual(0.4 * W);
    expect(c.x + c.w).toBeGreaterThanOrEqual(0.6 * W);
  });

  it('follows the face when it moves', () => {
    const left = faceCrop(face(0.2, 0.3, 0.4, 0.7), W, H, ASPECT);
    const right = faceCrop(face(0.6, 0.3, 0.8, 0.7), W, H, ASPECT);
    expect(right.x).toBeGreaterThan(left.x + 200);
  });

  it('never leaves the video, even for a face at the edge', () => {
    for (const f of [face(0, 0.3, 0.2, 0.7), face(0.8, 0.3, 1, 0.7), face(0.4, 0, 0.6, 0.4)]) {
      const c = faceCrop(f, W, H, ASPECT);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(W + 1e-6);
      expect(c.y + c.h).toBeLessThanOrEqual(H + 1e-6);
    }
  });

  it('a face bigger than the frame falls back to the whole frame', () => {
    const c = faceCrop(face(0, 0, 1, 1), W, H, ASPECT);
    expect(c.w).toBeLessThanOrEqual(W);
    expect(c.h).toBeLessThanOrEqual(H);
  });

  it('with no usable landmarks shows the whole frame', () => {
    expect(faceCrop([], W, H, ASPECT)).toEqual(fullCrop(W, H, ASPECT));
  });
});

describe('fullCrop / lerpCrop', () => {
  it('fullCrop is a centred crop of the frame at the aspect ratio', () => {
    const c = fullCrop(W, H, ASPECT);
    expect(c.h).toBeCloseTo(H);
    expect(c.w).toBeCloseTo(H * ASPECT);
    expect(c.x).toBeCloseTo((W - c.w) / 2);
  });

  it('lerpCrop moves part of the way', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    const b = { x: 100, y: 50, w: 200, h: 200 };
    expect(lerpCrop(a, b, 0.5)).toEqual({ x: 50, y: 25, w: 150, h: 150 });
    expect(lerpCrop(a, b, 0)).toEqual(a);
    expect(lerpCrop(a, b, 1)).toEqual(b);
  });
});
