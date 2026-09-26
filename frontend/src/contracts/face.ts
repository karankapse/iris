// ============================================================================
// Face tracking contracts. ONE FaceTracker owns the webcam + MediaPipe and emits
// FaceFrames. Eye Input (Module 1) and Emotion (Module 2) both subscribe to it.
// Video frames never leave this object; only these numbers are passed around.
// ============================================================================

export interface Point {
  /** 0..1 across the camera image (unmirrored) */
  x: number;
  y: number;
}

export interface FaceFrame {
  /** performance.now() in milliseconds */
  t: number;
  /** MediaPipe face blendshape scores (0..1), keyed by name, e.g. `eyeBlinkLeft`, `mouthSmileLeft`. */
  blendshapes: Record<string, number>;
  /**
   * Rough gaze direction, each axis in -1..1, from the USER's point of view:
   *   y: -1 = looking up,   +1 = looking down            (used by the app)
   *   x: -1 = looking left, +1 = looking right           (NOT verified on a real camera yet)
   * Derived from MediaPipe's `eyeLook*` blendshapes. It is uncalibrated: the eye input's
   * calibration finds this person's own thresholds.
   */
  gaze: { x: number; y: number };
  /**
   * Extra numbers computed from the face landmarks (not MediaPipe blendshapes).
   *   mouthAsymmetry: (left mouth corner height - right mouth corner height) / face height.
   *   0 = level mouth. Useful for users whose face is asymmetric (e.g. after a stroke).
   *   Measured as in Srihith's face-tracking demo (face/face.html).
   */
  metrics: Record<string, number>;
  /** All 478 landmark points, for drawing the camera overlay only. Empty in the mock. */
  landmarks: Point[];
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
