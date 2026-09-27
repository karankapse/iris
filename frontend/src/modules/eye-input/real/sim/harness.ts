// Runs the REAL calibration and eye input against a simulated person (see person.ts), then
// measures how well the result works in use. TEST-ONLY. Needs vitest's fake timers (the whole
// thing runs in simulated time, so minutes of use take well under a second).
import { vi } from 'vitest';
import { TARGET_POSITION, type CalibrationStep, type FaceFrame } from '../../../../contracts';
import type { FaceTracker } from '../../../../contracts';
import { createEmitter } from '../../../../core/emitter';
import { FilteredGaze, type GazeFilterParams } from '../../../../core/gaze/FilteredGaze';
import type { Zone } from '../corners';
import { RealEyeInput } from '../RealEyeInput';
import type { CalibrationOptions, CalibrationReport } from '../screenCalibration';
import { zoneAt } from '../screenZones';
import type { EyeTuning } from '../tuning';
import { Rng, SimPerson, SimWebGazer, type SimConfig } from './person';

class SimFaceTracker implements FaceTracker {
  video = null;
  private emitter = createEmitter<FaceFrame>();
  async start() {}
  stop() {}
  onFrame(h: (f: FaceFrame) => void) {
    return this.emitter.on(h);
  }
  emit(f: FaceFrame) {
    this.emitter.emit(f);
  }
}

export interface ScenarioOptions {
  sim?: Partial<SimConfig>;
  filter?: Partial<GazeFilterParams>;
  tuning?: Partial<EyeTuning>;
  /** Simulated minutes of ordinary use between calibration and the measurement (drift). */
  idleMinutes?: number;
  /** Rounds of rest -> left -> rest -> middle -> rest -> right in the measurement. */
  rounds?: number;
  /** Called at every calibration step (e.g. to make the head move during a step). */
  onStep?: (step: CalibrationStep, person: SimPerson) => void;
  /** Runs right after calibration, with the simulation still going (for probes and extra steps). */
  afterCalibration?: (ctx: {
    person: SimPerson;
    gaze: FilteredGaze;
    eye: RealEyeInput;
  }) => Promise<void>;
  /** Calibration options (see screenCalibration.ts). */
  calibration?: Partial<CalibrationOptions>;
  /** The person lets wrong selections be spoken too (never stops them): worst case for learning. */
  confirmWrong?: boolean;
}

export interface ScenarioResult {
  report: CalibrationReport;
  /** Share of gaze points (during steady looking) that land in the zone being looked at. */
  zoneAccuracy: Record<Zone, number>;
  /** Share of points in the right COLUMN while looking at an option (what matters most). */
  columnAccuracy: number;
  /** Mean horizontal error (px) while looking at the options. */
  horizontalErrorPx: number;
  /** Dwell / blink selections during the measurement (missed = nothing within 5 s). */
  selections: { correct: number; wrong: number; missed: number };
  /** Median time from starting to look at an option to its selection (ms). */
  selectMs: number;
  /** Column accuracy per round of the measurement (to see drift and learning over time). */
  columnByRound: number[];
  person: SimPerson;
  gaze: FilteredGaze;
  eye: RealEyeInput;
}

const FRAME_MS = 33;

/** Calibrate a simulated person, then measure. Call with fake timers on (see benchmark test). */
export async function runScenario(opts: ScenarioOptions = {}): Promise<ScenarioResult> {
  localStorage.clear();
  // the eye input logs its calibration results: keep the benchmark output readable
  const quiet = [vi.spyOn(console, 'info'), vi.spyOn(console, 'warn')];
  quiet.forEach((s) => s.mockImplementation(() => {}));
  const vp = { w: window.innerWidth, h: window.innerHeight };
  const person = new SimPerson(vp, opts.sim);
  const tracker = new SimFaceTracker();
  const wg = new SimWebGazer(person);
  const gaze = new FilteredGaze(wg);
  if (opts.filter) gaze.setParams(opts.filter);
  tracker.onFrame((f) => gaze.onFaceFrame(f));
  const eye = new RealEyeInput(tracker, gaze);
  if (opts.tuning) eye.setTuning(opts.tuning);
  if (opts.calibration) eye.calibrationOptions = opts.calibration;
  eye.start({ mode: 'full', optionCount: 3 });
  await gaze.start();

  const nan = new Rng((opts.sim?.seed ?? 7) + 1000);
  const timer = setInterval(() => {
    const t = performance.now();
    tracker.emit(person.step(t));
    wg.frame(t, nan.next());
  }, FRAME_MS);

  const px = (p: { x: number; y: number }) => ({ x: (p.x / 100) * vp.w, y: (p.y / 100) * vp.h });
  const onStep = (s: CalibrationStep) => {
    const t = performance.now();
    person.closeEyes(s.target === 'closed');
    if (s.target === 'point' && s.position) {
      const p = px(s.position);
      person.lookAt(p.x, p.y, t);
    } else if (
      s.target === 'center' ||
      s.target === 'left' ||
      s.target === 'middle' ||
      s.target === 'right'
    ) {
      const p = px(TARGET_POSITION[s.target]);
      person.lookAt(p.x, p.y, t);
    }
    // "slowly turn your head": left-right then up-down, a few degrees
    if (/turn your head/.test(s.prompt)) {
      const t0 = performance.now();
      person.headScript = (t) => ({
        yaw: 8 * Math.sin((2 * Math.PI * (t - t0)) / 4000),
        pitch: 5 * Math.sin((2 * Math.PI * (t - t0)) / 3000),
      });
    } else person.headScript = null;
    opts.onStep?.(s, person);
  };

  try {
    const done = eye.calibrate(onStep);
    let finished = false;
    void done.then(
      () => (finished = true),
      () => (finished = true),
    );
    for (let i = 0; i < 400 && !finished; i++) await vi.advanceTimersByTimeAsync(1000);
    await done;
    person.closeEyes(false);
    person.headScript = null;
    person.headOffset = { yaw: 0, pitch: 0 };
    const report = eye.lastCalibration()!;
    await opts.afterCalibration?.({ person, gaze, eye });

    // ordinary use: looking around the screen for a while (drift builds up)
    const idleMs = (opts.idleMinutes ?? 0) * 60_000;
    for (let t = 0; t < idleMs; t += 2000) {
      person.lookAt(
        vp.w * (0.1 + 0.8 * person.random()),
        vp.h * (0.1 + 0.8 * person.random()),
        performance.now(),
      );
      await vi.advanceTimersByTimeAsync(2000);
    }

    // the measurement: rest -> option -> rest -> ...
    const zoneHits: Record<Zone, { hit: number; n: number }> = {
      center: { hit: 0, n: 0 },
      left: { hit: 0, n: 0 },
      middle: { hit: 0, n: 0 },
      right: { hit: 0, n: 0 },
    };
    let column = { hit: 0, n: 0 };
    let hErr = 0;
    let looking: Zone = 'center';
    let lookingAt = { x: 0, y: 0 };
    let steadySince = Infinity;
    const offGaze = gaze.onGaze((p) => {
      if (!p || performance.now() < steadySince) return;
      const z = zoneAt(p.x, p.y, vp);
      zoneHits[looking].n++;
      if (z === looking) zoneHits[looking].hit++;
      if (looking !== 'center') {
        column = { hit: column.hit + (z === looking ? 1 : 0), n: column.n + 1 };
        hErr += Math.abs(p.x - lookingAt.x);
      }
    });
    const selections = { correct: 0, wrong: 0, missed: 0 };
    const latencies: number[] = [];
    let selectedThisLook = false;
    let pendingConfirm: boolean | null = null;
    const offEye = eye.on((e) => {
      if (e.type !== 'select') return;
      const zone = (['left', 'middle', 'right'] as const)[e.optionIndex];
      const right = zone === looking && !selectedThisLook;
      if (right) selections.correct++;
      else selections.wrong++;
      selectedThisLook = true;
      // like the app: it acts on the selection (speaks); the person lets a right one finish and
      // stops a wrong one
      eye.learning?.hold(performance.now());
      pendingConfirm = right || !!opts.confirmWrong;
    });
    const settle = () => {
      if (pendingConfirm === null) return;
      if (pendingConfirm) eye.learning?.confirm(performance.now());
      else eye.learning?.discard();
      pendingConfirm = null;
    };
    /** Look at a zone; at an option, keep looking until it is selected (or give up after 5 s). */
    const look = async (zone: Zone, ms: number) => {
      const p = px(TARGET_POSITION[zone]);
      looking = zone;
      lookingAt = p;
      selectedThisLook = false;
      const start = performance.now();
      person.lookAt(p.x, p.y, start);
      steadySince = start + 700;
      if (zone === 'center') return void (await vi.advanceTimersByTimeAsync(ms));
      while (!selectedThisLook && performance.now() - start < ms)
        await vi.advanceTimersByTimeAsync(100);
      if (selectedThisLook) latencies.push(performance.now() - start);
      else selections.missed++;
    };
    const perRound: number[] = [];
    for (let r = 0; r < (opts.rounds ?? 3); r++) {
      const before = { ...column };
      for (const zone of ['left', 'middle', 'right'] as const) {
        await look('center', 1500);
        settle(); // (the reply was spoken while resting)
        await look(zone, 5000);
      }
      perRound.push((column.hit - before.hit) / Math.max(1, column.n - before.n));
    }
    settle();
    offGaze();
    offEye();

    const acc = (z: Zone) => (zoneHits[z].n ? zoneHits[z].hit / zoneHits[z].n : NaN);
    return {
      report,
      zoneAccuracy: {
        center: acc('center'),
        left: acc('left'),
        middle: acc('middle'),
        right: acc('right'),
      },
      columnAccuracy: column.n ? column.hit / column.n : NaN,
      horizontalErrorPx: column.n ? hErr / column.n : NaN,
      selections,
      selectMs: median(latencies),
      columnByRound: perRound,
      person,
      gaze,
      eye,
    };
  } finally {
    clearInterval(timer);
    eye.stop();
    quiet.forEach((s) => s.mockRestore());
  }
}

/** One line of a results table. */
export function summary(name: string, r: ScenarioResult) {
  const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%`.padStart(4) : '  - ');
  const z = r.report.zones;
  return (
    `${name.padEnd(34)} check L/M/R ${pct(z.left)} ${pct(z.middle)} ${pct(z.right)} rest ${pct(z.center)}` +
    ` | use L/M/R ${pct(r.zoneAccuracy.left)} ${pct(r.zoneAccuracy.middle)} ${pct(r.zoneAccuracy.right)}` +
    ` rest ${pct(r.zoneAccuracy.center)} col ${pct(r.columnAccuracy)} hErr ${Math.round(
      r.horizontalErrorPx,
    )
      .toString()
      .padStart(4)}px` +
    ` | select ok ${r.selections.correct} wrong ${r.selections.wrong} missed ${r.selections.missed}` +
    ` in ${Number.isFinite(r.selectMs) ? (r.selectMs / 1000).toFixed(1) : '-'}s` +
    ` | raw ${Math.round(r.report.rawErrorPx)}px final ${Math.round(r.report.finalErrorPx)}px` +
    ` wX ${r.report.weights ? r.report.weights.x.toFixed(2) : '-'}` +
    (r.report.headGain
      ? ` head ${r.report.headGain.gainX.toFixed(0)}/${r.report.headGain.gainY.toFixed(0)}px/deg`
      : '') +
    (r.report.retried.length ? ` retried ${r.report.retried.join(',')}` : '')
  );
}

function median(v: number[]) {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
