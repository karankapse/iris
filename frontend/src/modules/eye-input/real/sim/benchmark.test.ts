// A small benchmark: the real calibration + eye input against a simulated person, per
// configuration. It prints a table (run: npx vitest run src/modules/eye-input/real/sim) so
// choices are made on evidence, and asserts only the conclusions we rely on.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runScenario, summary, type ScenarioOptions, type ScenarioResult } from './harness';

const lines: string[] = [];
const pct = (v: number) => `${Math.round(v * 100)}%`;
const results = new Map<string, ScenarioResult>();

async function run(name: string, opts: ScenarioOptions) {
  const r = await runScenario(opts);
  results.set(name, r);
  lines.push(summary(name, r));
  return r;
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
  });
});
afterEach(() => vi.useRealTimers());
afterAll(() => {
  console.log(
    `\nGaze benchmark (simulated person, window ${window.innerWidth}x${window.innerHeight})\n${lines.join('\n')}\n`,
  );
});

/** Roughly the pipeline as it was before these changes (what can still be switched back). */
const BEFORE: ScenarioOptions = {
  sim: { nativeMemory: 50 },
  filter: { patchModel: 0, skipBlinks: 0, driftRate: 0, headGainX: 20, headGainY: 20 },
  tuning: { dwellGraceMs: 0, calLearnFromCheck: 0, calLearnHeadGain: 0, onlineLearning: 0 },
  calibration: { passes: 1, collectScale: 1 },
};

describe('gaze benchmark', () => {
  it('before vs after (defaults), 5 people', async () => {
    const sum = {
      before: { col: 0, h: 0, ok: 0, wrong: 0 },
      after: { col: 0, h: 0, ok: 0, wrong: 0 },
    };
    for (const seed of [7, 21, 33, 45, 58]) {
      for (const [key, opts] of [
        ['before', BEFORE],
        ['after', {}],
      ] as const) {
        const r = await run(`${key} (person ${seed})`, {
          ...opts,
          sim: { ...opts.sim, seed },
          rounds: 4,
        });
        sum[key].col += r.columnAccuracy / 5;
        sum[key].h += r.horizontalErrorPx / 5;
        sum[key].ok += r.selections.correct;
        sum[key].wrong += r.selections.wrong;
      }
    }
    const line = (k: 'before' | 'after') =>
      `${k}: column ${pct(sum[k].col)}, horizontal error ${Math.round(sum[k].h)} px, selections ${sum[k].ok} right / ${sum[k].wrong} wrong of 60`;
    lines.push(`  -> ${line('before')}`, `  -> ${line('after')}`);
    expect(sum.after.col).toBeGreaterThan(sum.before.col);
    expect(sum.after.h).toBeLessThan(sum.before.h);
  }, 120_000);

  it('one training pass vs two half passes (default)', async () => {
    const people = [7, 21, 58];
    const err = { one: 0, two: 0 };
    for (const seed of people) {
      const one = await run(`1 pass (person ${seed})`, {
        sim: { seed },
        calibration: { passes: 1, collectScale: 1 },
      });
      const two = await run(`2 half passes (person ${seed})`, { sim: { seed } });
      err.one += one.horizontalErrorPx;
      err.two += two.horizontalErrorPx;
    }
    lines.push(
      `  -> horizontal error summed: 1 pass ${Math.round(err.one)}, 2 passes ${Math.round(err.two)}`,
    );
    expect(err.two).toBeLessThan(err.one);
  }, 60_000);

  it('learning during use, while the person slowly slumps (head 4-5 degrees over 2 min)', async () => {
    const people = [7, 21, 58];
    const late = async (name: string, opts: ScenarioOptions) => {
      let sum = 0;
      for (const seed of people) {
        const r = await run(`${name} (person ${seed})`, {
          ...opts,
          sim: { seed },
          rounds: 18,
          afterCalibration: async ({ person }) => {
            const t0 = performance.now();
            person.headScript = (t) => {
              const k = Math.min(1, (t - t0) / 120_000);
              return { yaw: 4 * k, pitch: 5 * k };
            };
          },
        });
        sum += r.columnByRound.slice(-6).reduce((a, b) => a + b, 0) / 6 / people.length;
      }
      return sum;
    };
    const off = await late('slump, no learning', { tuning: { onlineLearning: 0 } });
    const drift = await late('slump, drift offset (default)', {});
    const refit = await late('slump, re-fit only', {
      tuning: { onlineRefit: 1 },
      filter: { driftRate: 0 },
    });
    lines.push(
      `  -> last third, column accuracy: none ${pct(off)}, drift ${pct(drift)}, re-fit ${pct(refit)}`,
    );
    expect(drift).toBeGreaterThanOrEqual(off);
    expect(drift).toBeGreaterThanOrEqual(refit);
  }, 120_000);

  it('head compensation: fixed 20 px/deg vs off vs learned from calibration', async () => {
    const people = [7, 21, 58];
    const col = async (name: string, opts: ScenarioOptions, sim = {}) => {
      let sum = 0;
      for (const seed of people) {
        const r = await run(`${name} (person ${seed})`, { ...opts, sim: { seed, ...sim } });
        sum += r.columnAccuracy / people.length;
      }
      return sum;
    };
    const fixed = { calLearnHeadGain: 0 };
    const bigHead = { headYawSd: 5, headPitchSd: 3 };
    const still = {
      fixed: await col('head still, fixed +20', { tuning: fixed }),
      off: await col('head still, off', { tuning: fixed, filter: { headGainX: 0, headGainY: 0 } }),
      learned: await col('head still, learned (default)', {}),
      step: await col('head still, learned + head step', { tuning: { calHeadStep: 1 } }),
    };
    const moving = {
      fixed: await col('head moving, fixed +20', { tuning: fixed }, bigHead),
      off: await col(
        'head moving, off',
        { tuning: fixed, filter: { headGainX: 0, headGainY: 0 } },
        bigHead,
      ),
      learned: await col('head moving, learned (default)', {}, bigHead),
    };
    // (the simulated head's effect has the opposite sign to the old fixed guess)
    expect(still.learned).toBeGreaterThanOrEqual(still.off - 0.01);
    expect(moving.learned).toBeGreaterThan(moving.off + 0.03);
    expect(moving.learned).toBeGreaterThan(moving.fixed);
  }, 120_000);

  it('blinks, dwell grace and fixation detection', async () => {
    const people = [7, 21, 58];
    const total = async (name: string, opts: ScenarioOptions) => {
      const sum = { ok: 0, wrong: 0, missed: 0, col: 0 };
      for (const seed of people) {
        const r = await run(`${name} (person ${seed})`, { ...opts, sim: { seed }, rounds: 4 });
        sum.ok += r.selections.correct;
        sum.wrong += r.selections.wrong;
        sum.missed += r.selections.missed;
        sum.col += r.columnAccuracy / people.length;
      }
      return sum;
    };
    const blinksIn = await total('tracker used during blinks', { filter: { skipBlinks: 0 } });
    const base = await total('default (blinks skipped, grace 250)', {});
    const noGrace = await total('no dwell grace', { tuning: { dwellGraceMs: 0 } });
    const fix = await total('fixation detection 10%', { tuning: { fixSpread: 0.1 } });
    expect(base.col).toBeGreaterThan(blinksIn.col);
    expect(base.ok).toBeGreaterThanOrEqual(noGrace.ok);
    // webcam gaze is too noisy for a tight fixation box: it mostly stops selections (kept off)
    expect(fix.ok).toBeLessThan(base.ok);
  }, 60_000);

  it('check round: measure only vs also learn from it', async () => {
    const err = { off: 0, on: 0 };
    for (const seed of [7, 21, 58]) {
      const off = await run(`measure check only (person ${seed})`, {
        sim: { seed },
        tuning: { calLearnFromCheck: 0 },
      });
      const on = await run(`learn from check too (person ${seed})`, { sim: { seed } });
      err.off += off.horizontalErrorPx;
      err.on += on.horizontalErrorPx;
      // the report is the same honest measurement either way
      expect(on.report.finalErrorPx).toBeCloseTo(off.report.finalErrorPx, 0);
    }
    // neutral in simulation (8 people: 35.0 vs 34.8 px): kept on, it can only add data, and the
    // report is the same honest measurement either way
    lines.push(
      `  -> horizontal error summed: measure only ${Math.round(err.off)}, learn too ${Math.round(err.on)}`,
    );
    expect(err.on).toBeLessThan(err.off * 1.1);
  }, 60_000);

  it("WebGazer's default 50-sample memory vs a memory for the whole pass", async () => {
    const off = { patchModel: 0 };
    const small = await run('webgazer memory 50 (old)', { sim: { nativeMemory: 50 }, filter: off });
    const big = await run('webgazer memory 300', { sim: { nativeMemory: 300 }, filter: off });
    expect(big.report.rawErrorPx).toBeLessThan(small.report.rawErrorPx);
    const again = await run('webgazer memory 300 (same again)', {
      sim: { nativeMemory: 300 },
      filter: off,
    });
    expect(again.columnAccuracy).toBe(big.columnAccuracy); // runs are reproducible
  }, 60_000);

  it("our own cross-validated eye-patch model vs WebGazer's regression", async () => {
    const own = await run('own eye-patch model (memory 50)', { sim: { nativeMemory: 50 } });
    const own300 = await run('own eye-patch model (memory 300)', { sim: { nativeMemory: 300 } });
    const native = results.get('webgazer memory 300')!;
    expect(own.report.rawErrorPx).toBeLessThan(native.report.rawErrorPx * 1.1);
    expect(own300.columnAccuracy).toBeGreaterThanOrEqual(native.columnAccuracy - 0.02);
    // with as many features as the real WebGazer (120), its unregularised regression overfits
    const sim120 = { nativeMemory: 300, featureDim: 120 };
    const native120 = await run('webgazer memory 300, 120 features', {
      sim: sim120,
      filter: { patchModel: 0 },
    });
    const own120 = await run('own eye-patch model, 120 features', { sim: sim120 });
    expect(own120.report.rawErrorPx).toBeLessThan(native120.report.rawErrorPx);
  }, 60_000);
});
