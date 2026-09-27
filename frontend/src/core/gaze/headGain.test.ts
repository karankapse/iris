import { describe, expect, it } from 'vitest';
import { estimateHeadGain, type HeadPoint } from './headGain';

function rng(seed = 9) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
}

/** Dots where the head wanders; the estimate errs by `kx` px per degree of yaw (+ noise). */
function points(kx: number, ky: number, headSd: number, noise = 40): HeadPoint[] {
  const r = rng();
  const out: HeadPoint[] = [];
  for (let group = 0; group < 15; group++) {
    const bias = 80 * r(); // each dot has its own constant error: must not matter
    let yaw = headSd * r();
    let pitch = headSd * r();
    for (let k = 0; k < 20; k++) {
      yaw += headSd * 0.3 * r();
      pitch += headSd * 0.3 * r();
      // estimate = truth + k * yaw  ->  residual (target - estimate) = -k * yaw
      out.push({
        residX: bias - kx * yaw + noise * r(),
        residY: bias - ky * pitch + noise * r(),
        yaw,
        pitch,
        group,
      });
    }
  }
  return out;
}

describe('estimateHeadGain', () => {
  it('recovers gain and sign when the head moves enough', () => {
    const g = estimateHeadGain(points(30, -20, 4));
    // x -= gainX * yaw undoes an estimate that moved +30 px per degree
    expect(g.gainX).toBeGreaterThan(20);
    expect(g.gainX).toBeLessThan(35);
    // y += gainY * pitch undoes an estimate that moved -20 px per degree
    expect(g.gainY).toBeGreaterThan(12);
    expect(g.gainY).toBeLessThan(25);
  });

  it('stays off (0) when the head hardly moved or the effect is not clear', () => {
    expect(estimateHeadGain(points(30, 30, 0.2)).gainX).toBe(0);
    const noisy = estimateHeadGain(points(0, 0, 4, 150));
    expect(noisy.gainX).toBe(0);
    expect(noisy.gainY).toBe(0);
  });

  it('ignores a head that turns toward each dot (between dots), using movement within dots', () => {
    // head turned toward the dot, constant per dot; the estimate is simply biased per dot
    const pts: HeadPoint[] = [];
    for (let group = 0; group < 10; group++)
      for (let k = 0; k < 20; k++)
        pts.push({ residX: group * 30, residY: 0, yaw: group * 2, pitch: 0, group });
    expect(estimateHeadGain(pts).gainX).toBe(0);
  });

  it('skips broken numbers', () => {
    const pts = points(30, 0, 4);
    pts[3] = { ...pts[3], yaw: NaN };
    expect(Number.isFinite(estimateHeadGain(pts).gainX)).toBe(true);
  });
});
