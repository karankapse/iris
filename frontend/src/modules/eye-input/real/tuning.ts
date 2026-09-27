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
  /** Full mode: a corner must stay the best match this long before it counts (filters jitter). */
  regionHoldMs: number;
  /** Full mode: keep looking at an option's corner this long to select it (dwell). */
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
  regionHoldMs: 150,
  dwellMs: 2500,
  gazeHoldMs: 250,
  gazeStepMs: 700,
  cooldownMs: 800,
  settleMs: 300,
  frameGapMs: 300,
};

const STORAGE_KEY = 'iris.eyeTuning.v3';

export function loadTuning(): EyeTuning {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      const merged: EyeTuning = { ...DEFAULT_TUNING };
      for (const key of Object.keys(DEFAULT_TUNING) as (keyof EyeTuning)[]) {
        if (typeof saved[key] === 'number' && Number.isFinite(saved[key])) merged[key] = saved[key];
      }
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
  /** Median gaze.y while looking at the centre / up / down (up and down = the top and bottom corners). */
  centerY: number;
  upY: number;
  downY: number;
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

  if (closedBlink - openBlink >= MIN_BLINK_SEPARATION) {
    tuning.blinkClose = openBlink + (closedBlink - openBlink) * 0.6;
    tuning.blinkOpen = openBlink + (closedBlink - openBlink) * 0.35;
  } else {
    warnings.push('Closed eyes were hard to tell apart from open eyes.');
  }
  return { tuning, warnings };
}
