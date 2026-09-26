// ============================================================================
// Eye Input contracts  (Module 1)
// The rest of the app only knows these abstract events, never raw gaze numbers.
// ============================================================================

/** The three columns, where the 3 options sit (each column is a tall box; its words are at the bottom). */
export type Region = 'left' | 'middle' | 'right';

/**
 * Which column each on-screen option lives in, in option order. EVERY screen has exactly 3 options
 * (the third is always "Other…"), so in full mode this is always left, middle, right.
 * In 'vertical' mode there are no columns: options are stacked, and looking up/down steps the
 * highlight (many locked-in users can only move their eyes vertically). The UI and the eye
 * input both use this function, so what's drawn always matches where you have to look.
 */
export function optionRegions(optionCount: number, mode: 'full' | 'vertical'): Region[] {
  if (mode === 'vertical' || optionCount <= 0) return [];
  return (['left', 'middle', 'right'] as const).slice(0, Math.min(optionCount, 3));
}

/**
 * How the screen is divided, as fractions of the viewport (styles.css .columns-grid draws the same):
 *  - the TOP band (above `restBottom`) is the REST zone: "Partner said" and your face live there,
 *    and looking at them means "I'm not choosing anything";
 *  - below it, three columns: left | middle | right. You choose by looking at the words, which sit
 *    at the bottom of each column.
 */
export const LAYOUT = { restBottom: 0.5, leftColumn: 1 / 3, rightColumn: 2 / 3 } as const;

/**
 * Where on the screen (percent of width, height) each calibration target sits: the rest area at the
 * top, and the words at the bottom of each column. Shared so the calibration dots appear exactly
 * where the real text is drawn.
 */
export const TARGET_POSITION: Record<'center' | Region, { x: number; y: number }> = {
  center: { x: 50, y: 28 }, // the rest zone (between "Partner said" and the face view)
  left: { x: 17, y: 84 }, //   the column centres, at the height where the words are drawn
  middle: { x: 50, y: 84 },
  right: { x: 83, y: 84 },
};

export type EyeMode =
  | 'full' //     left/right/up/down + blinks
  | 'vertical'; // up/down + blinks only (many locked-in users can only move eyes vertically)

export type EyeEvent =
  /** The option currently looked at (null = none). `dwellProgress` 0..1 fills while looking. */
  | { type: 'highlight'; optionIndex: number | null; dwellProgress: number }
  /** The user chose option `optionIndex` (dwell completed or a deliberate blink). */
  | { type: 'select'; optionIndex: number }
  /** Yes / OK / speak now. (e.g. a long deliberate blink) */
  | { type: 'confirm' }
  /** No / go back / change. (e.g. a second gesture, defined in Module 1) */
  | { type: 'cancel' };

/** One instruction shown to the user (or caregiver) during calibration. */
export interface CalibrationStep {
  /** Where to look: a dot is shown at that spot ('closed' = eyes shut, no dot). */
  target: 'center' | Region | 'up' | 'down' | 'closed' | 'point';
  /** For target 'point': where to draw the dot, in percent of the screen. */
  position?: { x: number; y: number };
  /** e.g. "Look straight at the screen" */
  prompt: string;
  /** How long this step lasts. */
  seconds: number;
  /** 1-based position, for a "step 2 of 4" display. */
  index: number;
  total: number;
}

/** Adjustable by the user (abilities vary and change over time). See app/settings.ts. */
export interface EyeSettings {
  /** How long to keep looking at an option to select it (ms). */
  dwellMs: number;
  /** How long a blink must last to count as a deliberate "select" (ms). */
  blinkMs: number;
  /** How long a gaze must hold on a box before it counts (ms): higher = steadier, slower. */
  steadinessMs: number;
  /** Two quick blinks = go back (off by default: natural blinks can double up). */
  doubleBlinkBack: boolean;
}

export interface EyeInput {
  /** Begin emitting events for `optionCount` on-screen options (max 4). */
  start(options: { mode: EyeMode; optionCount: number }): void;
  /** The screen changed and now shows a different number of options. */
  setOptionCount(optionCount: number): void;
  stop(): void;
  /**
   * Short guided calibration (look at a dot in the centre and each corner, then close your eyes). Calls
   * `onStep` at the start of each step so the UI can show the instruction. While calibrating,
   * no other events are emitted. Rejects with a readable message if the face isn't visible.
   * Resolves with warnings (empty = all good) for signals that were too weak to trust, so the
   * UI can tell the person to try again instead of pretending it worked.
   */
  calibrate(onStep?: (step: CalibrationStep) => void): Promise<string[]>;
  /** Subscribe to events. Returns an unsubscribe function. */
  on(handler: (event: EyeEvent) => void): () => void;
  /** Apply the user's adjustable settings (safe to call any time). */
  configure?(settings: EyeSettings): void;
  /** Optional live diagnostics for the camera panel (which corner is detected, is it calibrated). */
  status?(): {
    region: 'center' | Region | null;
    calibrated: boolean;
    /** Measured at the end of calibration: share of gaze readings that landed in the right box (0..1). */
    accuracy?: number;
  };
}
