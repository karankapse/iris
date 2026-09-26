// The numbers that decide what counts as a blink, a look up/down/left/right, and a dwell.
// Defaults work for many people, but every face and camera is different, so calibrate()
// measures this person and replaces them.

export interface EyeTuning {
  /** Blink score (0 open .. 1 closed) above which the eyes count as closed. */
  blinkClose: number;
  /** ...and below which they count as open again (lower than blinkClose: hysteresis). */
  blinkOpen: number;
  /** Eyes closed at least this long = a deliberate blink = SELECT. Natural blinks are ~100-300 ms. */
  selectMs: number;
  /** Eyes held closed this long = CANCEL. */
  cancelMs: number;

  /** gaze.y at or below this = looking UP (negative). */
  gazeUp: number;
  /** gaze.y at or above this = looking DOWN (positive). */
  gazeDown: number;
  /**
   * Horizontal gaze. The camera-derived gaze.x may be mirrored on some setups, so calibration
   * works out `gazeXSign` (+1 or -1): x' = gaze.x * gazeXSign always means "to the user's right".
   */
  gazeXSign: 1 | -1;
  /** x' at or below this = looking LEFT (negative). */
  gazeLeft: number;
  /** x' at or above this = looking RIGHT (positive). */
  gazeRight: number;

  /** A new gaze region must hold this long before it counts (filters jitter). */
  regionHoldMs: number;
  /** Full mode: keep looking at an option this long to select it (dwell). */
  dwellMs: number;
  /** Vertical mode: look must be held this long before the highlight moves. */
  gazeHoldMs: number;
  /** Vertical mode: while the look is held, the highlight moves again every this many ms. */
  gazeStepMs: number;

  /** After any select/cancel, ignore further blinks for this long. */
  cooldownMs: number;
  /** After a blink, ignore gaze for this long (eyes roll while closing/opening). */
  settleMs: number;
  /** No frames for this long (face lost) = forget any blink in progress. */
  frameGapMs: number;
}

export const DEFAULT_TUNING: EyeTuning = {
  blinkClose: 0.55,
  blinkOpen: 0.35,
  selectMs: 500,
  cancelMs: 1500,
  gazeUp: -0.2,
  gazeDown: 0.3,
  gazeXSign: 1,
  gazeLeft: -0.25,
  gazeRight: 0.25,
  regionHoldMs: 150,
  dwellMs: 1500,
  gazeHoldMs: 250,
  gazeStepMs: 700,
  cooldownMs: 800,
  settleMs: 300,
  frameGapMs: 300,
};

const STORAGE_KEY = 'iris.eyeTuning.v2';

export function loadTuning(): EyeTuning {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      const merged: EyeTuning = { ...DEFAULT_TUNING };
      for (const key of Object.keys(DEFAULT_TUNING) as (keyof EyeTuning)[]) {
        if (key !== 'gazeXSign' && typeof saved[key] === 'number' && Number.isFinite(saved[key])) {
          (merged[key] as number) = saved[key];
        }
      }
      if (saved.gazeXSign === 1 || saved.gazeXSign === -1) merged.gazeXSign = saved.gazeXSign;
      return merged;
    }
  } catch {
    /* storage blocked or corrupt: use defaults */
  }
  return { ...DEFAULT_TUNING };
}

export function saveTuning(tuning: EyeTuning) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tuning));
  } catch {
    /* ignore */
  }
}

// ---- calibration maths (pure, so it can be tested) --------------------------------

export interface CalibrationSamples {
  /** Median gaze.y while looking straight / up / down. */
  centerY: number;
  upY: number;
  downY: number;
  /** Median gaze.x while looking straight / left / right. Absent when horizontal steps were skipped. */
  centerX?: number;
  leftX?: number;
  rightX?: number;
  /** Median blink score with eyes open (during the "straight" step) and closed. */
  openBlink: number;
  closedBlink: number;
}

/** Smallest change in a gaze value / blink score that we trust as a real signal. */
const MIN_GAZE_SEPARATION = 0.08;
const MIN_BLINK_SEPARATION = 0.25;

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Put each threshold half-way between "neutral" and the extreme this person actually reached.
 * If an extreme is indistinguishable from neutral we keep a default AND say so, so the UI can
 * ask for another try instead of pretending calibration worked.
 */
export function tuningFromSamples(
  samples: CalibrationSamples,
  base: EyeTuning = DEFAULT_TUNING,
): { tuning: EyeTuning; warnings: string[] } {
  const tuning = { ...base };
  const warnings: string[] = [];
  const { centerY, upY, downY, openBlink, closedBlink } = samples;

  if (centerY - upY >= MIN_GAZE_SEPARATION) tuning.gazeUp = centerY + (upY - centerY) * 0.5;
  else {
    tuning.gazeUp = centerY + DEFAULT_TUNING.gazeUp;
    warnings.push('Looking UP was hard to tell apart from looking straight.');
  }

  if (downY - centerY >= MIN_GAZE_SEPARATION) tuning.gazeDown = centerY + (downY - centerY) * 0.5;
  else {
    tuning.gazeDown = centerY + DEFAULT_TUNING.gazeDown;
    warnings.push('Looking DOWN was hard to tell apart from looking straight.');
  }

  const { centerX, leftX, rightX } = samples;
  if (centerX !== undefined && leftX !== undefined && rightX !== undefined) {
    if (Math.abs(rightX - leftX) >= 2 * MIN_GAZE_SEPARATION) {
      // Whichever way the numbers went when the person looked right defines "right".
      tuning.gazeXSign = rightX >= leftX ? 1 : -1;
      const c = centerX * tuning.gazeXSign;
      const l = leftX * tuning.gazeXSign;
      const r = rightX * tuning.gazeXSign;
      tuning.gazeLeft =
        c - l >= MIN_GAZE_SEPARATION ? c + (l - c) * 0.5 : c + DEFAULT_TUNING.gazeLeft;
      tuning.gazeRight =
        r - c >= MIN_GAZE_SEPARATION ? c + (r - c) * 0.5 : c + DEFAULT_TUNING.gazeRight;
      if (c - l < MIN_GAZE_SEPARATION)
        warnings.push('Looking LEFT was hard to tell apart from looking straight.');
      if (r - c < MIN_GAZE_SEPARATION)
        warnings.push('Looking RIGHT was hard to tell apart from looking straight.');
    } else {
      warnings.push(
        'Looking LEFT and RIGHT looked the same. Use vertical-only mode, or try again.',
      );
    }
  }

  if (closedBlink - openBlink >= MIN_BLINK_SEPARATION) {
    tuning.blinkClose = openBlink + (closedBlink - openBlink) * 0.6;
    tuning.blinkOpen = openBlink + (closedBlink - openBlink) * 0.35;
  } else {
    warnings.push('Closed eyes were hard to tell apart from open eyes.');
  }
  return { tuning, warnings };
}
