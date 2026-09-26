// ============================================================================
// Screen gaze: WHERE ON THE SCREEN is the person looking? (WebGazer, or the mouse for testing)
// Different from FaceTracker, which reports the face itself (blinks, expressions).
// ============================================================================

/** A gaze estimate in viewport pixels (0,0 = top-left of the browser window). */
export interface GazePoint {
  x: number;
  y: number;
  /** performance.now() in milliseconds, the same clock as FaceFrame.t */
  t: number;
}

export interface ScreenGaze {
  /** Start the camera-based gaze tracker (may ask for camera permission). */
  start(): Promise<void>;
  stop(): void;
  /** Subscribe to gaze estimates. `null` = no face was found this frame. Returns an unsubscribe. */
  onGaze(handler: (point: GazePoint | null) => void): () => void;
  /**
   * Teach the tracker: the person is looking at viewport (x, y) RIGHT NOW. Called during
   * calibration while a dot is on screen. (No mouse or click needed: works for people who can't.)
   */
  train(x: number, y: number): void;
  /** Forget everything that was learned (a fresh calibration). */
  clearTraining(): Promise<void>;
}
