import { describe, expect, it } from 'vitest';
import { ScreenZoneTracker, zoneAt } from './screenZones';

const VP = { w: 900, h: 800 };
// rest band: y < 520 (65%).  columns below it: 0-300 | 300-600 | 600-900

describe('zoneAt', () => {
  it('the top half is the rest zone ("Partner said" and the face)', () => {
    expect(zoneAt(100, 100, VP)).toBe('center');
    expect(zoneAt(450, 250, VP)).toBe('center');
    expect(zoneAt(850, 390, VP)).toBe('center');
    expect(zoneAt(450, 480, VP)).toBe('center'); // screen middle = resting, not choosing
  });

  it('below it, the three columns', () => {
    expect(zoneAt(100, 700, VP)).toBe('left');
    expect(zoneAt(450, 700, VP)).toBe('middle');
    expect(zoneAt(800, 700, VP)).toBe('right');
  });

  it('treats points off the screen as the nearest edge zone', () => {
    expect(zoneAt(-200, 2000, VP)).toBe('left');
    expect(zoneAt(1300, 2000, VP)).toBe('right');
    expect(zoneAt(450, -300, VP)).toBe('center');
  });
});

describe('ScreenZoneTracker', () => {
  const HOLD = 150;
  const make = () => new ScreenZoneTracker(HOLD, () => VP);
  /** Feed the same point for `ms` (20 samples/second, like WebGazer). */
  const look = (tr: ScreenZoneTracker, x: number, y: number, ms: number, t0: number) => {
    for (let t = t0; t < t0 + ms; t += 50) tr.update(t, { x, y }, false);
    return tr.current;
  };

  it('settles on the column being looked at, and returns to rest at the top', () => {
    const tr = make();
    expect(look(tr, 150, 700, 500, 0)).toBe('left');
    expect(look(tr, 800, 700, 500, 1000)).toBe('right');
    expect(look(tr, 450, 200, 500, 2000)).toBe('center');
  });

  it('ignores a glance shorter than the hold time', () => {
    const tr = make();
    look(tr, 450, 200, 500, 0);
    look(tr, 800, 700, 100, 600); // two samples
    expect(tr.current).toBe('center');
  });

  it('does not flicker when the gaze hovers on the edge between two columns', () => {
    const tr = make();
    look(tr, 150, 700, 500, 0); // left column
    let t = 1000;
    let changes = 0;
    let last = tr.current;
    for (let i = 0; i < 40; i++, t += 50) {
      tr.update(t, { x: 300 + (i % 2 ? 15 : -15), y: 700 }, false); // wobble around x = 300
      if (tr.current !== last) {
        changes += 1;
        last = tr.current;
      }
    }
    expect(changes).toBe(0);
    expect(tr.current).toBe('left');
  });

  it('does leave the column once the gaze is clearly outside it', () => {
    const tr = make();
    look(tr, 150, 700, 500, 0);
    expect(look(tr, 450, 700, 600, 1000)).toBe('middle');
  });

  it('smooths out a one-sample glitch far away', () => {
    const tr = make();
    look(tr, 450, 200, 500, 0);
    tr.update(600, { x: 850, y: 750 }, false); // a single wild prediction
    look(tr, 450, 200, 300, 650);
    expect(tr.current).toBe('center');
  });

  it('keeps the last zone when suppressed (eyes closing) or when there is no face', () => {
    const tr = make();
    look(tr, 800, 700, 500, 0);
    for (let t = 600; t < 1000; t += 50) tr.update(t, { x: 100, y: 100 }, true);
    for (let t = 1000; t < 1400; t += 50) tr.update(t, null, false);
    expect(tr.current).toBe('right');
  });
});
