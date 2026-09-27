import { describe, expect, it } from 'vitest';
import type { Point } from '../../contracts';
import {
  estimateGaze,
  eyeAspectRatio,
  headPoseFromMatrix,
  irisMetrics,
  mouthAsymmetry,
} from './faceMath';

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

describe('irisMetrics', () => {
  /** Two eyes, each 0.1 wide and 0.04 tall, with the irises at the given offsets from centre. */
  function eyes(irisDx: number, irisDy: number) {
    const pts = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    const setEye = (o: number, i: number, t: number, b: number, iris: number, cx: number) => {
      pts[o] = { x: cx - 0.05, y: 0.4 }; // outer/inner order does not matter for the maths
      pts[i] = { x: cx + 0.05, y: 0.4 };
      pts[t] = { x: cx, y: 0.38 };
      pts[b] = { x: cx, y: 0.42 };
      pts[iris] = { x: cx + irisDx, y: 0.4 + irisDy };
    };
    setEye(33, 133, 159, 145, 468, 0.4);
    setEye(263, 362, 386, 374, 473, 0.6);
    return pts;
  }

  it('is zero when the irises are centred in the eyes', () => {
    const m = irisMetrics(eyes(0, 0));
    expect(m.irisX).toBeCloseTo(0);
    expect(m.irisY).toBeCloseTo(0);
  });

  it('measures displacement in eye-widths, for both axes', () => {
    const m = irisMetrics(eyes(0.02, 0.01)); // 0.02 / 0.1 = 0.2 eye-widths right; 0.1 down
    expect(m.irisX).toBeCloseTo(0.2);
    expect(m.irisY).toBeCloseTo(0.1);
    expect(irisMetrics(eyes(-0.02, -0.01)).irisX).toBeCloseTo(-0.2);
  });

  it('returns zeros when the result has no iris landmarks', () => {
    expect(irisMetrics(eyes(0.02, 0).slice(0, 468))).toEqual({ irisX: 0, irisY: 0 });
  });
});

describe('irisMetrics with a tilted head (roll)', () => {
  /** One eye pair rotated by `deg` around the image centre, irises shifted along each eye. */
  function tilted(deg: number, along: number) {
    const pts = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    const r = (deg * Math.PI) / 180;
    const rot = (x: number, y: number) => ({
      x: 0.5 + (x - 0.5) * Math.cos(r) - (y - 0.5) * Math.sin(r),
      y: 0.5 + (x - 0.5) * Math.sin(r) + (y - 0.5) * Math.cos(r),
    });
    const setEye = (a: number, b: number, iris: number, cx: number) => {
      pts[a] = rot(cx - 0.05, 0.4);
      pts[b] = rot(cx + 0.05, 0.4);
      pts[iris] = rot(cx + along, 0.4);
    };
    setEye(33, 133, 468, 0.4);
    setEye(362, 263, 473, 0.6);
    return pts;
  }

  it('gives the same numbers whether or not the head is tilted', () => {
    const level = irisMetrics(tilted(0, 0.02));
    const tilt = irisMetrics(tilted(20, 0.02));
    expect(tilt.irisX).toBeCloseTo(level.irisX);
    expect(tilt.irisY).toBeCloseTo(level.irisY);
    expect(level.irisX).toBeCloseTo(0.2);
  });

  it('is the same at any distance from the camera (scale)', () => {
    const near = tilted(0, 0.02);
    const far = near.map((p) => ({ x: 0.5 + (p.x - 0.5) * 0.5, y: 0.5 + (p.y - 0.5) * 0.5 }));
    expect(irisMetrics(far).irisX).toBeCloseTo(irisMetrics(near).irisX);
  });
});

describe('eyeAspectRatio', () => {
  /** Both eyes 0.1 wide with the lids `open` apart. */
  function eyes(open: number) {
    const pts = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    const setEye = ([p1, p2, p3, p4, p5, p6]: number[], cx: number) => {
      pts[p1] = { x: cx - 0.05, y: 0.4 };
      pts[p4] = { x: cx + 0.05, y: 0.4 };
      pts[p2] = { x: cx - 0.02, y: 0.4 - open / 2 };
      pts[p3] = { x: cx + 0.02, y: 0.4 - open / 2 };
      pts[p6] = { x: cx - 0.02, y: 0.4 + open / 2 };
      pts[p5] = { x: cx + 0.02, y: 0.4 + open / 2 };
    };
    setEye([33, 160, 158, 133, 153, 144], 0.4);
    setEye([362, 385, 387, 263, 373, 380], 0.6);
    return pts;
  }

  it('is lid opening over eye width', () => {
    expect(eyeAspectRatio(eyes(0.03))).toBeCloseTo(0.3);
    expect(eyeAspectRatio(eyes(0.005))).toBeCloseTo(0.05);
  });

  it('corrects for a wide camera image', () => {
    // in a 16:9 image the same eye spans fewer "x units": the aspect puts it back
    const wide = eyes(0.03).map((p) => ({ x: 0.5 + (p.x - 0.5) / (16 / 9), y: p.y }));
    expect(eyeAspectRatio(wide, 16 / 9)).toBeCloseTo(0.3);
  });

  it('is 0 without landmarks', () => {
    expect(eyeAspectRatio([])).toBe(0);
  });
});
