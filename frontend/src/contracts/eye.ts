// ============================================================================
// Eye Input contracts  (Module 1)
// The rest of the app only knows these abstract events, never raw gaze numbers.
// ============================================================================

/** The four screen corners, where up to 4 options sit (a 2x2 grid that fills the screen). */
export type Region = 'up-left' | 'up-right' | 'down-left' | 'down-right';

/**
 * Which corner each on-screen option lives in, in option order (max 4 options), reading order:
 *   1 option: top-left    2: top-left, top-right    3: + bottom-left    4: + bottom-right
 * In 'vertical' mode there are no corners: options are stacked, and looking up/down steps the
 * highlight (many locked-in users can only move their eyes vertically). The UI and the eye
 * input both use this function, so what's drawn always matches where you have to look.
 */
export function optionRegions(optionCount: number, mode: 'full' | 'vertical'): Region[] {
  if (mode === 'vertical' || optionCount <= 0) return [];
  return (['up-left', 'up-right', 'down-left', 'down-right'] as const).slice(
    0,
    Math.min(optionCount, 4),
  );
}

/**
 * Where on the screen (percent of width, height) each calibration target and option sits.
 * Shared so the calibration dots appear exactly where the option cards are drawn.
 */
export const TARGET_POSITION: Record<'center' | Region, { x: number; y: number }> = {
  // The middle column holds the face view (top) and "Partner said" (bottom); its centre is the
  // screen centre, which is where the person rests their gaze.
  center: { x: 50, y: 50 },
  'up-left': { x: 18, y: 25 },
  'up-right': { x: 82, y: 25 },
  'down-left': { x: 18, y: 75 },
  'down-right': { x: 82, y: 75 },
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
  target: 'center' | Region | 'up' | 'down' | 'closed';
  /** e.g. "Look straight at the screen" */
  prompt: string;
  /** How long this step lasts. */
  seconds: number;
  /** 1-based position, for a "step 2 of 4" display. */
  index: number;
  total: number;
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
  /** Optional live diagnostics for the camera panel (which corner is detected, is it calibrated). */
  status?(): { region: 'center' | Region | null; calibrated: boolean };
}
