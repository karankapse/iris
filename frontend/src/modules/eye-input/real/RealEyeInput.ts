import { TARGET_POSITION, optionRegions } from '../../../contracts';
import type {
  CalibrationStep,
  EyeEvent,
  EyeInput,
  EyeMode,
  FaceFrame,
  EyeSettings,
  FaceTracker,
  GazePoint,
  ScreenGaze,
} from '../../../contracts';
import { createEmitter } from '../../../core/emitter';
import { FilteredGaze } from '../../../core/gaze/FilteredGaze';
import { BlinkDetector, type BlinkOutcome } from './blink';
import { FixationDetector } from './fixation';
import { OnlineLearner } from './onlineLearning';
import {
  CornerTracker,
  defaultCornerModel,
  gazeFeatures,
  loadCornerModel,
  saveCornerModel,
  trainCornerModel,
  ZONES,
  type Zone,
} from './corners';
import { GazeStepper } from './gaze';
import {
  DEFAULT_GLANCE,
  EyeGestures,
  glanceFromSamples,
  glanceValue,
  loadGlance,
  saveGlance,
  type GlanceTuning,
} from './glance';
import {
  ScreenCalibration,
  type CalibrationOptions,
  type CalibrationReport,
} from './screenCalibration';
import { ScreenZoneTracker } from './screenZones';
import {
  earCalibration,
  earClosure,
  earThreshold,
  loadTuning,
  median,
  saveTuning,
  tuningFromSamples,
  type CalibrationSamples,
  type EyeTuning,
} from './tuning';

/**
 * HOW THE USER CONTROLS THE APP WITH THEIR EYES
 * ---------------------------------------------
 * FULL mode: up to 4 options sit in the four CORNERS of the screen (a 2x2 grid).
 *   look at a corner        -> its option is highlighted
 *   keep looking (dwell)    -> a bar fills; when full, the option is SELECTED
 *   blink deliberately      -> selects the highlighted option immediately (faster than dwell)
 *   look at the centre      -> rest: nothing is highlighted and dwell restarts
 *   Which corner you are looking at is decided by a personal classifier trained during
 *   calibration (see corners.ts).
 *
 * VERTICAL mode (for people who can only move their eyes up and down):
 *   options are stacked in a list; look UP / DOWN and hold to move the highlight,
 *   then blink deliberately to SELECT.
 *
 * BOTH modes:
 *   deliberate blink = eyes closed ~0.5 s or more (natural blinks are ignored)
 *   keep the eyes closed ~1.5 s = CANCEL / go back
 *
 * Safety: after any selection, or when the screen changes, dwell is disarmed until the person
 * looks back at the centre, so a resting gaze never selects the next screen's option by itself.
 */

const BLINK_KEYS = ['eyeBlinkLeft', 'eyeBlinkRight'] as const;
/** Skip the first part of each calibration step: people need a moment to find the dot. */
const CALIBRATION_REACTION_MS = 900;
const MIN_CALIBRATION_FRAMES = 10;
const PROGRESS_STEP = 0.05;

// Screen-gaze calibration (WebGazer). Positions are percent of the screen.
const REPORT_KEY = 'iris.gazeCalibrationReport.v1';

function loadReport(): CalibrationReport | null {
  try {
    const r = JSON.parse(localStorage.getItem(REPORT_KEY) ?? 'null') as CalibrationReport | null;
    return r && Array.isArray(r.points) ? r : null;
  } catch {
    return null;
  }
}

function saveReport(report: CalibrationReport) {
  try {
    localStorage.setItem(REPORT_KEY, JSON.stringify(report));
  } catch {
    /* ignore */
  }
}

type StepKey = Zone | 'up' | 'down' | 'closed';
interface StepDef {
  key: StepKey;
  target: CalibrationStep['target'];
  prompt: string;
  seconds: number;
}

const COLUMN_NAME: Record<string, string> = {
  left: 'left',
  middle: 'middle',
  right: 'right',
};

const FULL_STEPS: StepDef[] = [
  {
    key: 'center',
    target: 'center',
    prompt: 'Look at the dot at the top (the rest area)',
    seconds: 3,
  },
  ...(['left', 'middle', 'right'] as const).map((z) => ({
    key: z,
    target: z,
    prompt: `Look at the words in the ${COLUMN_NAME[z]} column`,
    seconds: 3,
  })),
  {
    key: 'closed',
    target: 'closed',
    prompt: 'Close your eyes gently and keep them closed',
    seconds: 2.5,
  },
];

const VERTICAL_STEPS: StepDef[] = [
  { key: 'center', target: 'center', prompt: 'Look at the dot in the middle', seconds: 3 },
  { key: 'up', target: 'up', prompt: 'Look at the dot at the top', seconds: 3 },
  { key: 'down', target: 'down', prompt: 'Look at the dot at the bottom', seconds: 3 },
  {
    key: 'closed',
    target: 'closed',
    prompt: 'Close your eyes gently and keep them closed',
    seconds: 2.5,
  },
];

/** 0 (open) .. 1 (closed). Average of both eyes so a face that can't close one eye fully still works. */
export function blinkScore(frame: FaceFrame): number {
  return BLINK_KEYS.reduce((sum, k) => sum + (frame.blendshapes[k] ?? 0), 0) / BLINK_KEYS.length;
}

/** The frame's Eye Aspect Ratio, or 0 if it has no landmarks (e.g. the mock tracker). */
const earOf = (frame: FaceFrame) => frame.metrics.ear ?? 0;

/**
 * Blink and learned-thresholds for this person: EAR if the frames have landmarks and EAR could be
 * told apart open vs. closed, else MediaPipe's blink blendshapes. Returns what to feed
 * tuningFromSamples (closure medians) plus the EAR range to merge into the tuning.
 */
function blinkCalibration(open: FaceFrame[], closed: FaceFrame[]) {
  const ear = earCalibration(open.map(earOf), closed.map(earOf));
  return {
    // with EAR, closure is scaled to this person's own range, so open = 0 and closed = 1 by definition
    openBlink: ear ? 0 : median(open.map(blinkScore)),
    closedBlink: ear ? 1 : median(closed.map(blinkScore)),
    tuning: { ...(ear ?? {}), useEar: ear ? 1 : 0 },
  };
}

/** Live numbers for the gaze debug overlay: see why a selection did (or didn't) happen. */
export interface EyeDebugState {
  t: number;
  /** Current Eye Aspect Ratio (null when blinks come from blendshapes). */
  ear: number | null;
  /** EAR below which the eyes count as closed. */
  earThreshold: number;
  /** 0 open .. 1 closed, and the thresholds it is compared with. */
  closure: number;
  blinkClose: number;
  blinkOpen: number;
  eyesClosed: boolean;
  /** 0..1 toward a deliberate "select" blink. */
  blinkProgress: number;
  /** 0..1 toward a dwell selection. */
  dwellProgress: number;
  zone: Zone;
  /** False after a selection until the gaze rests at the top again. */
  armed: boolean;
  /** Milliseconds until another selection is allowed. */
  refractoryLeftMs: number;
  /** The dwell target circle (px), when dwell is measured against a screen point. */
  target: { x: number; y: number; r: number } | null;
  /** Is the gaze inside the target circle? */
  inTarget: boolean;
  /** Are the eyes holding still (always true with fixation detection off)? */
  fixating: boolean;
}

export class RealEyeInput implements EyeInput {
  private emitter = createEmitter<EyeEvent>();
  private tuning: EyeTuning = loadTuning();
  private blink = new BlinkDetector(this.tuning);
  private stepper = new GazeStepper(this.tuning); // vertical mode

  private savedModel = loadCornerModel();
  private corners = new CornerTracker(
    this.savedModel ?? defaultCornerModel(),
    this.tuning.regionHoldMs,
  ); // full mode

  // glance mode: look at a side / flick out and back (see glance.ts)
  private glanceTuning: GlanceTuning = loadGlance() ?? DEFAULT_GLANCE;
  private glance = new EyeGestures(this.glanceTuning);
  /** When the highlight last moved (glance mode): staying still for the dwell time selects. */
  private glanceMovedAt: number | null = null;

  private unsubscribe: (() => void) | null = null;
  private mode: EyeMode = 'full';
  private optionCount = 0;
  private highlighted: number | null = null;
  private lastProgress = 0;
  private blinkEndedAt = -Infinity;
  private lastFrameAt = -Infinity;
  private lastGazeAt = -Infinity;
  private blinkProgress = 0;
  private settling = false;
  private currentZone: Zone = 'center';
  private calibrating = false;
  private accuracy: number | undefined = loadReport()?.overall;
  private report: CalibrationReport | null = loadReport();
  /** Screen-coordinate gaze (WebGazer / mouse). null = use the MediaPipe corner classifier. */
  private zones = new ScreenZoneTracker(this.tuning.regionHoldMs);
  private unsubscribeGaze: (() => void) | null = null;
  /**
   * Screen gaze was calibrated in THIS page session. Not saved: WebGazer's training does not
   * survive a reload, so after one the tracker knows nothing even though a report was saved.
   */
  private screenCalibrated = false;

  // dwell (full mode)
  private dwellZone: Zone | null = null;
  /** Time (ms) spent looking at the current option so far, and for how long it has been paused. */
  private dwellAccum = 0;
  private dwellPausedFor = 0;
  private lastDwellT = -Infinity;
  private dwellProgress = 0;
  private fixation = new FixationDetector(this.tuning.fixWindowMs, 0);
  private fixating = true;
  /** Latest screen-gaze point (already smoothed), for the dwell radius. */
  private lastPoint: GazePoint | null = null;
  private inTarget = true;
  private lastSelectAt = -Infinity;
  private closure = 0;
  private ear: number | null = null;
  private debug = createEmitter<EyeDebugState>();
  /** False after a selection / screen change, until the person looks back at the centre. */
  private armed = false;

  /** Extra calibration options (tests and experiments). */
  calibrationOptions: Partial<CalibrationOptions> = {};

  /** While calibrating, frames go here instead of controlling the app. */
  private collector: ((frame: FaceFrame) => void) | null = null;

  /**
   * Learning from confirmed selections during use (screen gaze only). The app calls hold() when
   * it acts on a selection, then confirm() or discard().
   */
  readonly learning: OnlineLearner | null;

  constructor(
    private tracker: FaceTracker,
    private gaze: ScreenGaze | null = null,
  ) {
    this.learning = gaze instanceof FilteredGaze ? new OnlineLearner(gaze) : null;
    // FilteredGaze already smooths (One Euro); smoothing again here would only add lag.
    this.zones.setSmoothing(!(gaze instanceof FilteredGaze));
    this.applyTuning();
  }

  start(options: { mode: EyeMode; optionCount: number }) {
    this.unsubscribe?.();
    this.mode = options.mode;
    this.corners.reset();
    this.zones.reset();
    this.stepper.reset();
    this.glance.reset();
    this.glanceMovedAt = null;
    this.unsubscribe = this.tracker.onFrame((frame) => this.onFrame(frame));
    this.unsubscribeGaze?.();
    this.unsubscribeGaze = this.gaze?.onGaze((p) => this.onGaze(p)) ?? null;
    this.setOptionCount(options.optionCount);
  }

  setOptionCount(optionCount: number) {
    this.optionCount = optionCount;
    this.blink.invalidate(); // a blink that began on the previous screen must not act here
    this.stepper.reset();
    this.armed = false; // no dwell-select on a fresh screen until the gaze has rested at the centre
    this.dwellZone = null;
    this.glance.reset();
    this.glanceMovedAt = null;
    const index =
      this.mode === 'full'
        ? this.optionAt(this.currentZone)
        : optionCount === 0
          ? null
          : this.mode === 'glance'
            ? Math.floor((optionCount - 1) / 2) // glance mode starts in the middle
            : 0;
    this.setHighlight(index, 0);
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeGaze?.();
    this.unsubscribeGaze = null;
  }

  on(handler: (event: EyeEvent) => void) {
    return this.emitter.on(handler);
  }

  /** Live numbers for the debug overlay (not part of the EyeInput contract). */
  onDebug(handler: (state: EyeDebugState) => void) {
    return this.debug.on(handler);
  }

  /** Every threshold, for the tuning panel. */
  getTuning(): EyeTuning {
    return { ...this.tuning };
  }

  /** Change thresholds live (tuning panel). Saved, so they survive a reload. */
  setTuning(partial: Partial<EyeTuning>) {
    this.tuning = { ...this.tuning, ...partial };
    this.applyTuning();
    saveTuning(this.tuning);
  }

  private applyTuning() {
    if (this.learning) {
      this.learning.enabled = this.tuning.onlineLearning !== 0;
      this.learning.opts.refit = this.tuning.onlineRefit === 1;
    }
    this.fixation.windowMs = this.tuning.fixWindowMs;
    this.fixation.maxSpreadPx = this.tuning.fixSpread * window.innerWidth;
    this.blink.setTuning(this.tuning);
    this.stepper.setTuning(this.tuning);
    this.zones.setHoldMs(this.tuning.regionHoldMs);
    this.corners.setHoldMs(this.tuning.regionHoldMs);
  }

  /**
   * Apply the user's adjustable settings. They override the calibrated values for dwell time,
   * blink length and gaze steadiness (calibration still decides where the eyes are).
   */
  configure(settings: EyeSettings) {
    this.tuning = {
      ...this.tuning,
      dwellMs: settings.dwellMs,
      selectMs: settings.blinkMs,
      cancelMs: settings.blinkMs + 1000, // keep "hold the eyes closed" clearly longer than a select blink
      regionHoldMs: settings.steadinessMs,
    };
    this.applyTuning();
    this.blink.setDoubleBlink(settings.doubleBlinkBack);
  }

  status() {
    return {
      region: this.mode === 'full' ? this.currentZone : null,
      calibrated:
        this.mode === 'glance'
          ? loadGlance() !== null
          : this.mode !== 'full'
            ? true
            : this.gaze
              ? this.screenCalibrated
              : this.savedModel !== null,
      accuracy: this.accuracy,
    };
  }

  /** The option that sits in `zone` on the current screen (full mode), if any. */
  private optionAt(zone: Zone): number | null {
    if (zone === 'center') return null;
    const index = optionRegions(this.optionCount, 'full').indexOf(zone);
    return index === -1 ? null : index;
  }

  // ---- per-frame control ------------------------------------------------------------
  private onFrame(frame: FaceFrame) {
    if (this.collector) return this.collector(frame);
    if (this.calibrating) return;

    // Face lost for a moment: whatever gaze we were tracking is stale. Start fresh and wait
    // for the person to look at the centre again before any dwell can complete.
    if (frame.t - this.lastFrameAt > this.tuning.frameGapMs) {
      this.corners.reset();
      this.dwellZone = null;
      this.armed = false;
    }
    this.lastFrameAt = frame.t;

    this.closure = this.closureOf(frame);
    const { outcome, progress } = this.blink.update(frame.t, this.closure);
    this.blinkProgress = progress;
    if (this.blink.closed) this.blinkEndedAt = frame.t;
    // Eyes roll while closing and opening, so freeze gaze around blinks.
    this.settling = this.blink.closed || frame.t - this.blinkEndedAt < this.tuning.settleMs;

    if (this.mode === 'full') {
      // With screen gaze, zones come from onGaze(); here only the blink can act on the current zone.
      const zone = this.gaze
        ? this.currentZone
        : this.corners.update(frame.t, gazeFeatures(frame), this.settling);
      this.applyZone(frame.t, zone, outcome);
    } else if (this.mode === 'glance') {
      this.onFrameGlance(frame, outcome, progress);
    } else this.onFrameVertical(frame, outcome, progress, this.settling);

    // holding the eyes closed cancels; so does a double blink, if the user turned that on
    if (outcome === 'cancel' || outcome === 'double') {
      this.learning?.discard();
      this.emitter.emit({ type: 'cancel' });
    }
    this.emitDebug(frame.t);
  }

  /** 0 (open) .. 1 (closed): EAR scaled to this person's range, or the blink blendshapes. */
  private closureOf(frame: FaceFrame): number {
    const ear = earOf(frame);
    if (this.tuning.useEar && ear > 0) {
      this.ear = ear;
      return earClosure(ear, this.tuning);
    }
    this.ear = null;
    return blinkScore(frame);
  }

  /** The dwell target circle for `zone` in pixels: centred on where the option's words are drawn. */
  private targetOf(zone: Zone) {
    if (zone === 'center') return null;
    const pos = TARGET_POSITION[zone];
    return {
      x: (pos.x / 100) * window.innerWidth,
      y: (pos.y / 100) * window.innerHeight,
      r: this.tuning.dwellRadius * window.innerWidth,
    };
  }

  private emitDebug(t: number) {
    const target = this.gaze ? this.targetOf(this.currentZone) : null;
    this.debug.emit({
      t,
      ear: this.ear,
      earThreshold: earThreshold(this.tuning),
      closure: this.closure,
      blinkClose: this.tuning.blinkClose,
      blinkOpen: this.tuning.blinkOpen,
      eyesClosed: this.blink.closed,
      blinkProgress: this.blinkProgress,
      dwellProgress: this.dwellProgress,
      zone: this.currentZone,
      armed: this.armed,
      refractoryLeftMs: Math.max(0, this.lastSelectAt + this.tuning.refractoryMs - t),
      target,
      inTarget: this.inTarget,
      fixating: this.fixating,
    });
  }

  /** A screen-gaze estimate (WebGazer or the mouse): decide which box it is in. */
  private onGaze(p: GazePoint | null) {
    if (!p || this.collector || this.calibrating || this.mode !== 'full') return;
    if (p.t - this.lastGazeAt > this.tuning.frameGapMs * 3) {
      // gaze estimates stopped for a while: start fresh
      this.zones.reset();
      this.dwellZone = null;
      this.armed = false;
    }
    this.lastGazeAt = p.t;
    this.lastPoint = p;
    this.fixation.push(p.t, p.x, p.y);
    this.fixating = this.fixation.fixating;
    const zone = this.zones.update(p.t, p, this.settling);
    this.applyZone(p.t, zone, null);
    this.emitDebug(p.t);
  }

  /** Dwell + blink selection for the zone currently looked at (full mode). */
  private applyZone(t: number, zone: Zone, outcome: BlinkOutcome) {
    this.currentZone = zone;
    const index = this.optionAt(zone);
    const dt = Math.max(0, Math.min(100, t - this.lastDwellT)); // frames and gaze points interleave
    this.lastDwellT = Math.max(this.lastDwellT, t);

    // Dwell restarts whenever the zone changes; looking at the centre re-arms it.
    if (zone !== this.dwellZone) {
      this.dwellZone = zone;
      this.dwellAccum = 0;
      this.dwellPausedFor = 0;
    }
    if (zone === 'center') this.armed = true;

    // With a screen point, dwell only counts inside the target circle.
    const target = this.targetOf(zone);
    this.inTarget =
      !target || !this.lastPoint
        ? true
        : Math.hypot(this.lastPoint.x - target.x, this.lastPoint.y - target.y) <= target.r;
    // With screen gaze, only fresh gaze points count toward a dwell: if the gaze tracker stopped
    // (lost the face, or only reports "no reading") while camera frames keep coming, the last
    // known position must not complete a selection on its own.
    const fresh = !this.gaze || t - this.lastGazeAt <= this.tuning.frameGapMs;
    const counting =
      index !== null && this.armed && !this.settling && this.inTarget && fresh && this.fixating;
    if (counting) {
      this.dwellAccum += dt;
      this.dwellPausedFor = 0;
    } else {
      // a moment outside the circle / a blink / a saccade only pauses the dwell; longer resets it
      this.dwellPausedFor += dt;
      if (!fresh || this.dwellPausedFor > this.tuning.dwellGraceMs) this.dwellAccum = 0;
    }

    let dwellProgress =
      index !== null && this.armed ? Math.min(1, this.dwellAccum / this.tuning.dwellMs) : 0;

    // A deliberate blink selects what you are looking at; so does a full dwell.
    if (index !== null && (outcome === 'select' || dwellProgress >= 1)) {
      this.select(index, t); // (too soon after the last selection: nothing, and the dwell starts over)
      this.dwellAccum = 0;
      dwellProgress = 0;
    }

    this.dwellProgress = dwellProgress;
    this.setHighlight(index, Math.max(this.blinkProgress, dwellProgress));
  }

  private onFrameVertical(
    frame: FaceFrame,
    outcome: BlinkOutcome,
    blinkProgress: number,
    settling: boolean,
  ) {
    if (outcome === 'select' && this.highlighted !== null) this.select(this.highlighted, frame.t);
    const step = this.stepper.update(frame.t, frame.gaze.y, settling);
    let next = this.highlighted;
    if (step !== 0 && this.optionCount > 0) {
      next = Math.max(0, Math.min(this.optionCount - 1, (this.highlighted ?? 0) + step));
    }
    this.setHighlight(next, blinkProgress);
  }

  /**
   * GLANCE mode: looking at a side highlights that side's option; a quick flick left/right (out and
   * back) moves one option that way. Staying on an option for the dwell time (7 s by default)
   * selects it, and so does a deliberate blink.
   */
  private onFrameGlance(frame: FaceFrame, outcome: BlinkOutcome, blinkProgress: number) {
    const t = frame.t;
    if (this.glanceMovedAt === null) this.glanceMovedAt = t;
    let index = this.highlighted;

    const gesture = this.glance.update(
      t,
      glanceValue(frame, this.glanceTuning.signal),
      this.settling,
    );
    if (gesture && this.optionCount > 0 && index !== null) {
      const last = this.optionCount - 1;
      const side = gesture.dir === 'left' ? -1 : 1;
      const next =
        gesture.type === 'look'
          ? side < 0 // looking AT a side: jump to that side's option
            ? 0
            : last
          : Math.max(0, Math.min(last, index + side)); // flick out and back: one step
      if (next !== index) {
        index = next;
        this.glanceMovedAt = t; // moving restarts the countdown
      }
    }

    let dwell = 0;
    if (index !== null && !this.settling) {
      dwell = Math.min(1, (t - this.glanceMovedAt) / this.tuning.dwellMs);
    }
    if (index !== null && (outcome === 'select' || dwell >= 1) && this.select(index, t)) {
      this.glanceMovedAt = t; // (the screen usually changes; if not, count again from now)
      dwell = 0;
    }
    this.dwellProgress = dwell;
    this.setHighlight(index, Math.max(blinkProgress, dwell));
  }

  /** Returns false (and does nothing) during the refractory period after the previous selection. */
  private select(optionIndex: number, t: number): boolean {
    if (t - this.lastSelectAt < this.tuning.refractoryMs) return false;
    this.lastSelectAt = t;
    this.armed = false; // must look back at the centre before the next dwell can complete
    // remember what was looked at just before (learned from only if the app confirms it)
    const zone = optionRegions(this.optionCount, 'full')[optionIndex];
    const target = zone && this.mode === 'full' ? this.targetOf(zone) : null;
    if (zone && target) this.learning?.selected(t, zone, target);
    this.emitter.emit({ type: 'select', optionIndex });
    return true;
  }

  /** Emit a `highlight` event only when something visible changed. */
  private setHighlight(index: number | null, progress: number) {
    const moved = index !== this.highlighted;
    const progressChanged =
      Math.abs(progress - this.lastProgress) >= PROGRESS_STEP ||
      (progress === 0) !== (this.lastProgress === 0);
    if (!moved && !progressChanged) return;
    this.highlighted = index;
    this.lastProgress = progress;
    this.emitter.emit({ type: 'highlight', optionIndex: index, dwellProgress: progress });
  }

  // ---- calibration ---------------------------------------------------------------------
  async calibrate(onStep?: (step: CalibrationStep) => void): Promise<string[]> {
    if (this.collector || this.calibrating) throw new Error('Calibration is already running.');
    if (this.gaze && this.mode === 'full') return this.calibrateScreen(onStep);
    if (this.mode === 'glance') return this.calibrateGlance(onStep);

    const steps = this.mode === 'full' ? FULL_STEPS : VERTICAL_STEPS;
    const frames: Partial<Record<StepKey, FaceFrame[]>> = {};
    try {
      for (const [i, step] of steps.entries()) {
        onStep?.({
          target: step.target,
          prompt: step.prompt,
          seconds: step.seconds,
          index: i + 1,
          total: steps.length,
        });

        const collected: FaceFrame[] = [];
        const startedAt = performance.now();
        this.collector = (f) => {
          if (f.t - startedAt >= CALIBRATION_REACTION_MS) collected.push(f);
        };
        await new Promise((resolve) => setTimeout(resolve, step.seconds * 1000));
        this.collector = null;

        if (collected.length < MIN_CALIBRATION_FRAMES) {
          throw new Error(
            `I couldn't see the face during "${step.prompt}". Check the camera and lighting, and keep the face in view.`,
          );
        }
        frames[step.key] = collected;
      }
    } finally {
      this.collector = null;
    }

    const warnings: string[] = [];
    const medianY = (fs: FaceFrame[]) => median(fs.map((f) => f.gaze.y));
    const f = frames as Record<StepKey, FaceFrame[]>;

    // 1) which corner is which (full mode only)
    if (this.mode === 'full') {
      const samples = {} as Record<Zone, number[][]>;
      // frames taken mid-blink say nothing about where the person looks: leave them out
      for (const z of ZONES)
        samples[z] = f[z].filter((fr) => blinkScore(fr) < 0.4).map(gazeFeatures);
      const trained = trainCornerModel(samples);
      if (!trained)
        throw new Error('Not enough usable camera frames to learn the corners. Try again.');
      this.corners.setModel(trained.model);
      this.savedModel = trained.model;
      saveCornerModel(trained.model);
      warnings.push(...trained.warnings);
      console.info(
        '[eye calibration] corner model',
        JSON.stringify({ weight: trained.model.weight, sigma: trained.model.sigma }),
      );
    }

    // 2) blink and up/down thresholds (used by vertical mode, and to detect blinks)
    // full mode: the rest band is at the top of the screen, the columns' words at the bottom
    const topY = this.mode === 'full' ? medianY(f.center) : medianY(f.up);
    const bottomY =
      this.mode === 'full'
        ? (medianY(f.left) + medianY(f.middle) + medianY(f.right)) / 3
        : medianY(f.down);
    const blinkCal = blinkCalibration(f.center, f.closed);
    const samples: CalibrationSamples = {
      centerY: this.mode === 'full' ? (topY + bottomY) / 2 : medianY(f.center),
      upY: topY,
      downY: bottomY,
      openBlink: blinkCal.openBlink,
      closedBlink: blinkCal.closedBlink,
    };
    console.info('[eye calibration] samples', JSON.stringify({ ...samples, ...blinkCal.tuning }));

    const result = tuningFromSamples(samples, { ...this.tuning, ...blinkCal.tuning });
    warnings.push(...result.warnings);
    for (const w of warnings) console.warn('[eye calibration]', w);

    this.tuning = result.tuning;
    this.blink.setTuning(result.tuning);
    this.stepper.setTuning(result.tuning);
    this.corners.setHoldMs(result.tuning.regionHoldMs);
    saveTuning(result.tuning);
    return warnings;
  }

  // ---- calibration for GLANCE mode: straight, left, right, eyes closed (~11 s) ------------------
  private async calibrateGlance(onStep?: (step: CalibrationStep) => void): Promise<string[]> {
    const steps = [
      { key: 'center', target: 'center', prompt: 'Look straight at the middle', seconds: 3 },
      {
        key: 'left',
        target: 'left',
        prompt: 'Look at the LEFT option (eyes only, head still)',
        seconds: 2.5,
      },
      {
        key: 'right',
        target: 'right',
        prompt: 'Look at the RIGHT option (eyes only, head still)',
        seconds: 2.5,
      },
      {
        key: 'closed',
        target: 'closed',
        prompt: 'Close your eyes gently and keep them closed',
        seconds: 2.5,
      },
    ] as const;
    const frames: Record<string, FaceFrame[]> = {};
    this.calibrating = true;
    try {
      for (const [i, step] of steps.entries()) {
        onStep?.({
          target: step.target,
          prompt: step.prompt,
          seconds: step.seconds,
          index: i + 1,
          total: steps.length,
        });
        const collected: FaceFrame[] = [];
        const startedAt = performance.now();
        this.collector = (f) => {
          if (f.t - startedAt >= CALIBRATION_REACTION_MS) collected.push(f);
        };
        await new Promise((r) => setTimeout(r, step.seconds * 1000));
        this.collector = null;
        if (collected.length < MIN_CALIBRATION_FRAMES) {
          throw new Error(
            `I couldn't see the face during "${step.prompt}". Check the camera and lighting.`,
          );
        }
        frames[step.key] = collected;
      }
    } finally {
      this.collector = null;
      this.calibrating = false;
    }

    const { tuning, warnings } = glanceFromSamples(
      { center: frames.center, left: frames.left, right: frames.right },
      this.glanceTuning,
    );
    console.info('[glance calibration]', JSON.stringify(tuning));
    this.glanceTuning = tuning;
    this.glance.setTuning(tuning);
    saveGlance(tuning);

    // blink thresholds from the same session
    const blinkCal = blinkCalibration(frames.center, frames.closed);
    if (blinkCal.closedBlink - blinkCal.openBlink >= 0.25) {
      const { openBlink: open, closedBlink: closed } = blinkCal;
      this.tuning = {
        ...this.tuning,
        ...blinkCal.tuning,
        blinkClose: open + (closed - open) * 0.6,
        blinkOpen: open + (closed - open) * 0.35,
      };
      this.blink.setTuning(this.tuning);
      saveTuning(this.tuning);
    } else {
      warnings.push('Closed eyes were hard to tell apart from open eyes.');
    }
    this.glanceMovedAt = null;
    return warnings;
  }

  // ---- calibration with screen gaze (WebGazer + face landmarks) -------------------------------
  /**
   * Hands-free: check the face position, then dots the person looks at while both gaze estimates
   * learn, then a check round that corrects and combines them (see screenCalibration.ts). The
   * blink thresholds are learned from the same frames.
   */
  private async calibrateScreen(onStep?: (step: CalibrationStep) => void): Promise<string[]> {
    this.calibrating = true;
    this.screenCalibrated = false;
    const frames: Record<string, FaceFrame[]> = {};
    let phase: string | null = null;
    const calibration = new ScreenCalibration({
      gaze: this.gaze!,
      onStep,
      setPhase: (key) => (phase = key),
      options: {
        learnFromCheck: this.tuning.calLearnFromCheck !== 0,
        learnHeadGain: this.tuning.calLearnHeadGain !== 0,
        headStep: this.tuning.calHeadStep !== 0,
        ...this.calibrationOptions,
      },
    });
    this.collector = (f) => {
      calibration.observe(f);
      if (phase) (frames[phase] ??= []).push(f);
    };
    let warnings: string[];
    try {
      const result = await calibration.run();
      warnings = result.warnings;
      this.report = result.report;
      this.accuracy = result.report.overall;
      saveReport(result.report);
      console.info('[gaze calibration]', JSON.stringify({ ...result.report, points: undefined }));

      // blink + up/down thresholds, from the frames we saw along the way
      const rows = [frames.row0 ?? [], frames.row1 ?? [], frames.row2 ?? []];
      const open = rows.flat();
      const closed = frames.closed ?? [];
      const medianY = (fs: FaceFrame[]) => median(fs.map((f) => f.gaze.y));
      if (open.length >= 10 && closed.length >= 10 && rows[0].length && rows[2].length) {
        const blinkCal = blinkCalibration(open, closed);
        const upY = medianY(rows[0]);
        const downY = medianY(rows[2]);
        const result2 = tuningFromSamples(
          {
            centerY: (upY + downY) / 2,
            upY,
            downY,
            openBlink: blinkCal.openBlink,
            closedBlink: blinkCal.closedBlink,
          },
          { ...this.tuning, ...blinkCal.tuning },
        );
        // gaze up/down thresholds only matter in vertical mode; the blink ones matter here
        warnings.push(...result2.warnings.filter((w) => w.startsWith('Closed')));
        this.tuning = result2.tuning;
        this.applyTuning();
        saveTuning(result2.tuning);
      } else {
        warnings.push("I couldn't see the face well enough to learn your blink.");
      }
      this.screenCalibrated = true;
    } finally {
      this.collector = null;
      this.calibrating = false;
      this.zones.reset();
      this.dwellZone = null;
      this.armed = false;
    }
    for (const w of warnings) console.warn('[eye calibration]', w);
    return warnings;
  }

  /** The last screen-gaze calibration's results (for the setup screen's map). */
  lastCalibration(): CalibrationReport | null {
    return this.report;
  }
}
