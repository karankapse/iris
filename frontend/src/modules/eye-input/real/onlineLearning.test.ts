import { beforeEach, describe, expect, it } from 'vitest';
import type { GazePoint, ScreenGaze } from '../../../contracts';
import { createEmitter } from '../../../core/emitter';
import { FilteredGaze } from '../../../core/gaze/FilteredGaze';
import { OnlineLearner } from './onlineLearning';

class FakeGaze implements ScreenGaze {
  private emitter = createEmitter<GazePoint | null>();
  async start() {}
  stop() {}
  onGaze(h: (p: GazePoint | null) => void) {
    return this.emitter.on(h);
  }
  train() {}
  async clearTraining() {}
  emit(p: GazePoint | null) {
    this.emitter.emit(p);
  }
}

const VP = { w: 1000, h: 800 };
const target = { x: 830, y: 672 }; // the right option's words

async function setup() {
  localStorage.clear();
  const inner = new FakeGaze();
  const gaze = new FilteredGaze(inner);
  gaze.setParams({ minCutoff: 1000, headGainX: 0, headGainY: 0, driftRate: 0.5 });
  await gaze.start();
  const learner = new OnlineLearner(gaze, () => VP);
  /** The tracker says (x, y) for `ms` (30 fps), ending at time `end`. */
  const look = (x: number, y: number, end: number, ms = 1500) => {
    for (let t = end - ms; t <= end; t += 33) inner.emit({ x, y, t });
  };
  return { inner, gaze, learner, look };
}

describe('OnlineLearner', () => {
  beforeEach(() => localStorage.clear());

  it('learns a drift offset from a confirmed selection, toward the option', async () => {
    const { gaze, learner, look } = await setup();
    const t = performance.now();
    look(760, 640, t); // the estimate sits 70 px left of / 32 px above the words
    learner.selected(t, 'right', target);
    learner.hold(t + 10);
    expect(learner.confirm(t + 2000)).toBeGreaterThan(0);
    const d = gaze.driftOffset();
    expect(d.x).toBeGreaterThan(20); // half the error (rate 0.5), toward the target
    expect(d.y).toBeGreaterThan(5);
  });

  it('never learns from a discarded (stopped) selection, or one not acted on', async () => {
    const { gaze, learner, look } = await setup();
    const t = performance.now();
    look(760, 640, t);
    learner.selected(t, 'right', target);
    learner.hold(t);
    learner.discard();
    expect(learner.confirm(t + 2000)).toBe(0);
    learner.selected(t, 'right', target); // selected, but the app never acted on it (no hold)
    expect(learner.confirm(t + 2000)).toBe(0);
    expect(gaze.driftOffset()).toEqual({ x: 0, y: 0 });
  });

  it('ignores a look that was not steadily in the selected box', async () => {
    const { learner, look, gaze } = await setup();
    const t = performance.now();
    look(500, 650, t); // the middle column, although "right" got selected
    learner.selected(t, 'right', target);
    learner.hold(t);
    expect(learner.confirm(t + 1000)).toBe(0);
    expect(gaze.driftOffset()).toEqual({ x: 0, y: 0 });
  });

  it('rate-limits, expires, and can be switched off', async () => {
    const { learner, look } = await setup();
    let t = performance.now();
    look(760, 640, t);
    learner.selected(t, 'right', target);
    learner.hold(t);
    expect(learner.confirm(t + 100)).toBeGreaterThan(0);
    look(770, 650, t + 1200, 1100);
    learner.selected(t + 1200, 'right', target);
    learner.hold(t + 1200);
    expect(learner.confirm(t + 1300)).toBe(0); // too soon after the last one

    t += 10_000;
    look(770, 650, t);
    learner.selected(t, 'right', target);
    learner.hold(t);
    expect(learner.confirm(t + 60_000)).toBe(0); // confirmed far too late

    learner.enabled = false;
    t += 70_000;
    look(770, 650, t);
    learner.selected(t, 'right', target);
    learner.hold(t);
    expect(learner.confirm(t + 100)).toBe(0);
  });

  it('keeps the offset within bounds', async () => {
    const { gaze, learner, look } = await setup();
    let t = performance.now();
    for (let i = 0; i < 20; i++, t += 6000) {
      look(250, 672, t); // wildly off, again and again (in the right box only by assumption)
      learner.selected(t, 'right', target);
      learner.hold(t);
      learner.confirm(t + 100);
    }
    // it never learned from those (not in the right box), and in any case stays bounded
    expect(Math.abs(gaze.driftOffset().x)).toBeLessThanOrEqual(0.15 * window.innerWidth);
  });
});
