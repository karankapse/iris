import { describe, expect, it } from 'vitest';
import { fitRidge, predictRidge, validModel, type RidgeSample } from './ridge';

function rng(seed = 3) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
}

/** 9 dots on a grid; features = a linear view of the dot plus `junk` irrelevant noisy features. */
function data(junk: number, noise = 0.01, perDot = 12) {
  const r = rng();
  const samples: RidgeSample[] = [];
  let group = 0;
  for (const gx of [100, 500, 900])
    for (const gy of [100, 400, 700]) {
      for (let k = 0; k < perDot; k++) {
        const u = gx / 1000 + noise * r();
        const v = gy / 1000 + noise * r();
        samples.push({
          f: [u + 0.3 * v, v - 0.2 * u, ...Array.from({ length: junk }, () => r())],
          x: gx,
          y: gy,
          group,
        });
      }
      group++;
    }
  return samples;
}

const opts = { lambdas: [0.01, 1, 100, 10000], minGroups: 6, minSamples: 40 };

describe('fitRidge', () => {
  it('learns a linear mapping and reports a small held-out error', () => {
    const fit = fitRidge(data(0), opts)!;
    expect(fit.model.errX).toBeLessThan(20);
    expect(fit.model.errY).toBeLessThan(20);
    const p = predictRidge(fit.model, [0.5 + 0.3 * 0.4, 0.4 - 0.2 * 0.5]);
    expect(p.x).toBeCloseTo(500, -1);
    expect(p.y).toBeCloseTo(400, -1);
    expect(validModel(fit.model)).toBe(true);
  });

  it("held-out predictions never see their own dot's samples", () => {
    const samples = data(0);
    // one dot claims a target far away from what its features say: in-sample it would be pulled
    // toward that target, held out it can't be
    for (const s of samples) if (s.group === 4) s.x = 3000;
    const fit = fitRidge(samples, opts)!;
    const heldOut = fit.cv.filter((_, k) => samples[k].group === 4);
    for (const p of heldOut) expect(Math.abs(p.x - 500)).toBeLessThan(Math.abs(p.x - 3000));
  });

  it('picks the regularisation with the smallest held-out error, per axis', () => {
    const samples = data(50, 0.05, 8);
    const fit = fitRidge(samples, opts)!;
    const single = opts.lambdas.map((l) => fitRidge(samples, { ...opts, lambdas: [l] })!.model);
    expect(fit.model.errX).toBeCloseTo(Math.min(...single.map((m) => m.errX)));
    expect(fit.model.errY).toBeCloseTo(Math.min(...single.map((m) => m.errY)));
  });

  it('refuses too few dots or inconsistent feature lengths', () => {
    expect(
      fitRidge(
        data(0).filter((s) => s.group < 3),
        opts,
      ),
    ).toBeNull();
    const bad = data(0);
    bad[5] = { ...bad[5], f: [1] };
    expect(fitRidge(bad, opts)).toBeNull();
    expect(validModel({ mean: [1], std: [1], wx: [1], wy: [1, 2], errX: 1, errY: 1 })).toBe(false);
  });
});
