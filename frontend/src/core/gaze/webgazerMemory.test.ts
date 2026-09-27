// WebGazer's regression keeps only its last 50 training samples by default, so a 13-dot
// calibration forgot all but the last few dots. These tests run against WebGazer's own source.
import { describe, expect, it } from 'vitest';
// @ts-expect-error: WebGazer ships no types for its sources
import ridgeReg from 'webgazer/src/ridgeReg.mjs';
import { WEBGAZER_MEMORY, widenMemory } from './WebGazerGaze';

interface Window {
  data: unknown[];
  windowSize: number;
  push(v: unknown): void;
}

function fill(reg: Record<string, Window>, n: number) {
  for (let i = 0; i < n; i++) {
    reg.screenXClicksArray.push([i]);
    reg.screenYClicksArray.push([i]);
    reg.eyeFeaturesClicks.push([i]);
    reg.dataClicks.push({ i });
  }
}

describe('WebGazer training memory', () => {
  it('by default keeps only the last 50 samples (why calibration forgot most dots)', () => {
    const reg = new ridgeReg.RidgeReg();
    fill(reg, 13 * 16);
    expect(reg.screenXClicksArray.data).toHaveLength(50);
  });

  it(`remembers ${WEBGAZER_MEMORY} once widened: a whole calibration pass`, () => {
    const reg = new ridgeReg.RidgeReg();
    widenMemory({ getRegression: () => [reg] });
    fill(reg, 13 * 16);
    for (const k of ['screenXClicksArray', 'screenYClicksArray', 'eyeFeaturesClicks', 'dataClicks'])
      expect(reg[k].data).toHaveLength(13 * 16);
    fill(reg, 1000); // still bounded
    expect(reg.eyeFeaturesClicks.data).toHaveLength(WEBGAZER_MEMORY);
    // the newest samples are the ones kept
    expect(reg.screenXClicksArray.data).toContainEqual([999]);
    expect(reg.screenXClicksArray.data).not.toContainEqual([0]);
  });

  it('leaves unexpected objects alone', () => {
    expect(() => widenMemory({ getRegression: () => [null, {}, { dataClicks: 5 }] })).not.toThrow();
    expect(() =>
      widenMemory({
        getRegression: () => {
          throw new Error('x');
        },
      }),
    ).not.toThrow();
  });
});
