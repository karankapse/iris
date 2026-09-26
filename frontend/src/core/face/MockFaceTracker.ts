import type { FaceFrame, FaceTracker } from '../../contracts';
import { createEmitter } from '../emitter';

/** Emits a still, neutral face at 10 fps. No camera needed. Used when all face modules are mocked. */
export class MockFaceTracker implements FaceTracker {
  readonly video = null;
  private emitter = createEmitter<FaceFrame>();
  private timer: ReturnType<typeof setInterval> | null = null;

  async start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.emitter.emit({
        t: performance.now(),
        blendshapes: {},
        gaze: { x: 0, y: 0 },
        headPose: { yaw: 0, pitch: 0, roll: 0 },
        metrics: {},
        landmarks: [],
      });
    }, 100);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onFrame(handler: (frame: FaceFrame) => void) {
    return this.emitter.on(handler);
  }
}
