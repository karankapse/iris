import { describe, expect, it } from 'vitest';
import { FixationDetector } from './fixation';

describe('FixationDetector (I-DT)', () => {
  it('holding still is a fixation; a jump is not, until the eyes hold still again', () => {
    const d = new FixationDetector(150, 60);
    let t = 0;
    for (; t < 200; t += 33) d.push(t, 500 + (t % 2) * 10, 300);
    expect(d.fixating).toBe(true);
    d.push(t, 900, 320); // saccade
    expect(d.fixating).toBe(false);
    for (t += 33; t < 450; t += 33) d.push(t, 905, 318);
    expect(d.fixating).toBe(true);
  });

  it('needs most of a window of points, and can be switched off', () => {
    const d = new FixationDetector(150, 60);
    d.push(0, 1, 1);
    expect(d.fixating).toBe(false);
    d.maxSpreadPx = 0;
    expect(d.fixating).toBe(true);
  });
});
