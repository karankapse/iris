import { describe, expect, it } from 'vitest';
import type { Point } from '../../contracts';
import { estimateGaze, headPoseFromMatrix, mouthAsymmetry } from './faceMath';

/** 478 dummy points, with the ones the maths uses set explicitly. */
function face(overrides: Record<number, Point>): Point[] {
  const pts = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  for (const [i, p] of Object.entries(overrides)) pts[Number(i)] = p;
  return pts;
}

// forehead (10) at y=0.2, chin (152) at y=0.8 -> face height 0.6; eyes at y=0.4
const base = {
  10: { x: 0.5, y: 0.2 },
  152: { x: 0.5, y: 0.8 },
  33: { x: 0.4, y: 0.4 },
  263: { x: 0.6, y: 0.4 },
};

describe("mouthAsymmetry (from Srihith's face demo)", () => {
  it('is 0 for a level mouth', () => {
    const L = face({ ...base, 61: { x: 0.45, y: 0.65 }, 291: { x: 0.55, y: 0.65 } });
    expect(mouthAsymmetry(L)).toBeCloseTo(0);
  });

  it('is the corner height difference divided by face height, with a sign', () => {
    const L = face({ ...base, 61: { x: 0.45, y: 0.68 }, 291: { x: 0.55, y: 0.62 } });
    expect(mouthAsymmetry(L)).toBeCloseTo(0.06 / 0.6); // = 0.1
    const flipped = face({ ...base, 61: { x: 0.45, y: 0.62 }, 291: { x: 0.55, y: 0.68 } });
    expect(mouthAsymmetry(flipped)).toBeCloseTo(-0.1);
  });

  it('does not divide by zero when the face has no height', () => {
    const L = face({ ...base, 10: { x: 0.5, y: 0.5 }, 152: { x: 0.5, y: 0.5 } });
    expect(mouthAsymmetry(L)).toBe(0);
  });
});

describe('estimateGaze', () => {
  it('is neutral with no signal', () => {
    expect(estimateGaze({})).toEqual({ x: 0, y: 0 });
  });

  it('reports down as positive y and up as negative y', () => {
    expect(estimateGaze({ eyeLookDownLeft: 0.8, eyeLookDownRight: 0.6 }).y).toBeCloseTo(0.7);
    expect(estimateGaze({ eyeLookUpLeft: 0.5, eyeLookUpRight: 0.5 }).y).toBeCloseTo(-0.5);
  });

  it('stays within -1..1', () => {
    expect(estimateGaze({ eyeLookDownLeft: 1, eyeLookDownRight: 1, eyeLookUpLeft: -3 }).y).toBe(1);
  });
});

describe('headPoseFromMatrix', () => {
  it('returns zeros without a matrix and for the identity matrix', () => {
    expect(headPoseFromMatrix(undefined)).toEqual({ yaw: 0, pitch: 0, roll: 0 });
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const pose = headPoseFromMatrix(identity);
    expect(pose.yaw).toBeCloseTo(0);
    expect(pose.pitch).toBeCloseTo(0);
    expect(pose.roll).toBeCloseTo(0);
  });
});
