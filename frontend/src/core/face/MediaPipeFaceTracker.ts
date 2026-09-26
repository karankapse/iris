import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceFrame, FaceTracker } from '../../contracts';
import { createEmitter } from '../emitter';
import { estimateGaze, headPoseFromMatrix, mouthAsymmetry } from './faceMath';

// Files are served from /public. Run `npm run setup:mediapipe` once to put them there.
const WASM_PATH = '/mediapipe/wasm';
const MODEL_PATH = '/models/face_landmarker.task';

/**
 * Owns the webcam and MediaPipe. Emits numeric FaceFrames (only when a face is visible).
 * The video itself never leaves this class except as the `video` element used for the preview.
 * Landmark overlay + mouth-asymmetry metric come from Srihith's face-tracking demo.
 */
export class MediaPipeFaceTracker implements FaceTracker {
  video: HTMLVideoElement | null = null;
  private emitter = createEmitter<FaceFrame>();
  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private lastVideoTime = -1;
  /** Bumped by every start()/stop() so a slow start() can tell it has been cancelled. */
  private generation = 0;

  async start() {
    if (this.landmarker || this.stream) return;
    const generation = ++this.generation;
    const cancelled = () => generation !== this.generation;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false, // the camera stream never includes audio
      });
    } catch (e) {
      throw new Error(describeCameraError(e), { cause: e });
    }
    if (cancelled()) return stream.getTracks().forEach((t) => t.stop());
    this.stream = stream;

    const video = document.createElement('video');
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;
    await video.play();
    if (cancelled()) return;
    this.video = video;

    let landmarker: FaceLandmarker;
    try {
      landmarker = await this.createLandmarker('GPU');
    } catch {
      // Some machines have no usable WebGL/GPU delegate: the CPU one is slower but works.
      landmarker = await this.createLandmarker('CPU').catch((e) => {
        throw new Error(
          `Could not load the face model (${e instanceof Error ? e.message : e}). ` +
            'Did you run "npm run setup:mediapipe"?',
          { cause: e },
        );
      });
    }
    if (cancelled()) return landmarker.close();
    this.landmarker = landmarker;
    this.loop();
  }

  stop() {
    this.generation++; // cancels any start() still in flight
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.landmarker?.close();
    this.stream = null;
    this.landmarker = null;
    this.video = null;
    this.lastVideoTime = -1;
  }

  onFrame(handler: (frame: FaceFrame) => void) {
    return this.emitter.on(handler);
  }

  private async createLandmarker(delegate: 'GPU' | 'CPU') {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    return FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
  }

  private loop = () => {
    const video = this.video;
    if (this.landmarker && video && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      try {
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
            gaze: estimateGaze(blendshapes),
            metrics: { mouthAsymmetry: mouthAsymmetry(landmarks) },
            landmarks: landmarks.map((p) => ({ x: p.x, y: p.y })),
            headPose: headPoseFromMatrix(result.facialTransformationMatrixes[0]?.data),
          });
        }
      } catch (e) {
        console.warn('[face tracker] frame error:', e); // never let one bad frame kill the loop
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };
}

function describeCameraError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError') {
      return 'Camera permission was denied. Allow the camera in the browser and reload.';
    }
    if (e.name === 'NotFoundError') return 'No camera found.';
    if (e.name === 'NotReadableError') return 'The camera is in use by another app.';
  }
  return `Could not start the camera: ${e instanceof Error ? e.message : String(e)}`;
}
