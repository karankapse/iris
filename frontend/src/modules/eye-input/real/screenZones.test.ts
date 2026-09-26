import { describe, expect, it } from 'vitest';
import { ScreenZoneTracker, zoneAt } from './screenZones';

const VP = { w: 1000, h: 800 };
// columns: 0-360 | 360-640 | 640-1000, rows: 0-400 | 400-800

describe('zoneAt', () => {
  it('finds the corner boxes and the middle column', () => {
    expect(zoneAt(100, 100, VP)).toBe('up-left');
    expect(zoneAt(900, 100, VP)).toBe('up-right');
    expect(zoneAt(100, 700, VP)).toBe('down-left');
    expect(zoneAt(900, 700, VP)).toBe('down-right');
    expect(zoneAt(500, 100, VP)).toBe('center'); // face view
    expect(zoneAt(500, 700, VP)).toBe('center'); // "partner said"
  });

  it('treats points off the screen as the nearest edge zone', () => {
    expect(zoneAt(-200, -50, VP)).toBe('up-left');
    expect(zoneAt(1300, 2000, VP)).toBe('down-right');
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

  it('settles on the box being looked at, and returns to rest in the middle', () => {
    const tr = make();
    expect(look(tr, 150, 150, 500, 0)).toBe('up-left');
    expect(look(tr, 850, 650, 500, 1000)).toBe('down-right');
    expect(look(tr, 500, 400, 500, 2000)).toBe('center');
  });

  it('ignores a glance shorter than the hold time', () => {
    const tr = make();
    look(tr, 500, 400, 500, 0);
    look(tr, 850, 150, 100, 600); // two samples
    expect(tr.current).toBe('center');
  });

  it('does not flicker when the gaze hovers on the edge between two boxes', () => {
    const tr = make();
    look(tr, 150, 150, 500, 0); // in the top-left box
    // wobble around the column boundary (x = 360): +-15 px, well inside the sticky margin
    let t = 1000;
    let changes = 0;
    let last = tr.current;
    for (let i = 0; i < 40; i++, t += 50) {
      tr.update(t, { x: 360 + (i % 2 ? 15 : -15), y: 150 }, false);
      if (tr.current !== last) {
        changes += 1;
        last = tr.current;
      }
    }
    expect(changes).toBe(0);
    expect(tr.current).toBe('up-left');
  });

  it('does leave the box once the gaze is clearly outside it', () => {
    const tr = make();
    look(tr, 150, 150, 500, 0);
    expect(look(tr, 560, 150, 600, 1000)).toBe('center'); // 200 px past the edge
  });

  it('smooths out a one-sample glitch far away', () => {
    const tr = make();
    look(tr, 500, 400, 500, 0);
    tr.update(600, { x: 950, y: 50 }, false); // a single wild prediction
    look(tr, 500, 400, 300, 650);
    expect(tr.current).toBe('center');
  });

  it('keeps the last zone when suppressed (eyes closing) or when there is no face', () => {
    const tr = make();
    look(tr, 850, 650, 500, 0);
    for (let t = 600; t < 1000; t += 50) tr.update(t, { x: 100, y: 100 }, true);
    for (let t = 1000; t < 1400; t += 50) tr.update(t, null, false);
    expect(tr.current).toBe('down-right');
  });
});
