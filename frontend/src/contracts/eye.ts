// ============================================================================
// Eye Input contracts  (Module 1)
// The rest of the app only knows these abstract events, never raw gaze numbers.
// ============================================================================

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
   * Short guided calibration (look straight, up, down, close your eyes). Calls `onStep` at the
   * start of each step so the UI can show the instruction. While calibrating, no other events
   * are emitted. Rejects with a readable message if the face isn't visible.
   */
  calibrate(onStep?: (step: CalibrationStep) => void): Promise<void>;
  /** Subscribe to events. Returns an unsubscribe function. */
  on(handler: (event: EyeEvent) => void): () => void;
}
