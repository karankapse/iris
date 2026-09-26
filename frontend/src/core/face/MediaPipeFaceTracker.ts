import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceFrame, FaceTracker } from '../../contracts';
import { createEmitter } from '../emitter';

// Files are served from /public. Run `npm run setup:mediapipe` once to put them there.
const WASM_PATH = '/mediapipe/wasm';
const MODEL_PATH = '/models/face_landmarker.task';

// MediaPipe face-mesh landmark indices (468 face points + 10 iris points).
// Names are from the USER's point of view (their right eye appears on the LEFT of the image).
const RIGHT_EYE = { outer: 33, inner: 133, top: 159, bottom: 145, iris: 468 };
const LEFT_EYE = { outer: 263, inner: 362, top: 386, bottom: 374, iris: 473 };

type Point = { x: number; y: number };
type Eye = typeof RIGHT_EYE;

const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));

/**
 * Where is the iris inside the eye opening? Returns 0..1 on each axis.
 *   x: 0 = iris at the outer corner, 1 = at the inner corner (nose side)
 *   y: 0 = at the upper lid, 1 = at the lower lid
 */
function irisPosition(lm: Point[], eye: Eye) {
  const iris = lm[eye.iris];
  const outer = lm[eye.outer];
  const inner = lm[eye.inner];
  const top = lm[eye.top];
  const bottom = lm[eye.bottom];
  return {
    x: (iris.x - outer.x) / (inner.x - outer.x || 1e-6),
    y: (iris.y - top.y) / (bottom.y - top.y || 1e-6),
  };
}

/** Owns the webcam and MediaPipe. Emits numeric FaceFrames; video never leaves this class. */
export class MediaPipeFaceTracker implements FaceTracker {
  video: HTMLVideoElement | null = null;
  private emitter = createEmitter<FaceFrame>();
  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private lastVideoTime = -1;

  async start() {
    if (this.landmarker) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false, // the camera stream never includes audio
    });
    const video = document.createElement('video');
    video.srcObject = this.stream;
    video.playsInline = true;
    await video.play();
    this.video = video;

    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    this.loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.landmarker?.close();
    this.stream = null;
    this.landmarker = null;
    this.video = null;
  }

  onFrame(handler: (frame: FaceFrame) => void) {
    return this.emitter.on(handler);
  }

  private loop = () => {
    const video = this.video;
    if (this.landmarker && video && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      const now = performance.now();
      const result = this.landmarker.detectForVideo(video, now);
      const landmarks = result.faceLandmarks[0];
      if (landmarks) {
        const blendshapes: Record<string, number> = {};
        for (const c of result.faceBlendshapes[0]?.categories ?? []) {
          blendshapes[c.categoryName] = c.score;
        }
        this.emitter.emit({
          t: now,
          blendshapes,
          gaze: this.estimateGaze(landmarks),
          headPose: this.estimateHeadPose(result.facialTransformationMatrixes[0]?.data),
        });
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  /**
   * ROUGH gaze estimate from iris position. Averages both eyes, then maps to -1..1
   * (see FaceFrame.gaze for the axis convention). The gains are guesses:
   * Module 1's calibration should tune/replace them.
   */
  private estimateGaze(lm: Point[]) {
    const r = irisPosition(lm, RIGHT_EYE);
    const l = irisPosition(lm, LEFT_EYE);
    // Horizontal: for the user's RIGHT eye, "outer corner" is toward the user's right, so
    // a small x means looking right. For the LEFT eye it's the opposite. Combine to +1 = user's right.
    const lookRight = (0.5 - r.x + (l.x - 0.5)) / 2;
    const lookDown = (r.y + l.y) / 2 - 0.5;
    return { x: clamp(lookRight * 5), y: clamp(lookDown * 5) };
  }

  /** Rotation (degrees) from MediaPipe's 4x4 column-major transform matrix. */
  private estimateHeadPose(m?: Float32Array | number[]) {
    if (!m) return { yaw: 0, pitch: 0, roll: 0 };
    const deg = 180 / Math.PI;
    return {
      pitch: Math.asin(-clamp(m[9])) * deg,
      yaw: Math.atan2(m[8], m[10]) * deg,
      roll: Math.atan2(m[1], m[5]) * deg,
    };
  }
}
