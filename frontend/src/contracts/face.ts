// ============================================================================
// Face tracking contracts. ONE FaceTracker owns the webcam + MediaPipe and emits
// FaceFrames. Eye Input (Module 1) and Emotion (Module 2) both subscribe to it.
// Video frames never leave this object; only these numbers are passed around.
// ============================================================================

export interface FaceFrame {
  /** performance.now() in milliseconds */
  t: number;
  /** MediaPipe face blendshape scores (0..1), keyed by name, e.g. `eyeBlinkLeft`, `mouthSmileLeft`. */
  blendshapes: Record<string, number>;
  /**
   * Rough gaze direction, each axis in -1..1, from the USER's point of view:
   *   x: -1 = looking to their left,  +1 = to their right
   *   y: -1 = looking up,             +1 = down
   * Derived from the iris position relative to the eye corners. It is uncalibrated: Module 1's
   * calibration maps it to left/right/up/down thresholds. (The camera image is mirrored
   * relative to the user, so the FaceTracker is responsible for flipping x.)
   */
  gaze: { x: number; y: number };
  /** Head rotation in degrees. Useful to ignore gaze while the head moves. */
  headPose: { yaw: number; pitch: number; roll: number };
}

export interface FaceTracker {
  /** Ask for camera permission and start emitting frames. */
  start(): Promise<void>;
  stop(): void;
  /** Subscribe to frames. Returns an unsubscribe function. */
  onFrame(handler: (frame: FaceFrame) => void): () => void;
  /** The <video> element showing the camera (for a small preview), if any. */
  readonly video: HTMLVideoElement | null;
}
