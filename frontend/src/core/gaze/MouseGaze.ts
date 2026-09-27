import type { GazePoint, ScreenGaze } from '../../contracts';
import { createEmitter } from '../emitter';

const TICK_MS = 50; // 20 estimates a second, like a real tracker

/**
 * Stand-in for the camera: your MOUSE POINTER is the "gaze". Lets everyone develop and test the
 * corner selection (highlight, dwell, blink) without a camera or a calibration. Select it with
 * VITE_GAZE_ENGINE=mouse. (Blinks still come from the camera, or from the keyboard mock.)
 */
export class MouseGaze implements ScreenGaze {
  private emitter = createEmitter<GazePoint | null>();
  private last: { x: number; y: number } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  async start() {
    if (this.timer) return;
    window.addEventListener('mousemove', this.onMove);
    this.timer = setInterval(() => {
      this.emitter.emit(this.last ? { ...this.last, t: performance.now() } : null);
    }, TICK_MS);
  }

  stop() {
    window.removeEventListener('mousemove', this.onMove);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onGaze(handler: (point: GazePoint | null) => void) {
    return this.emitter.on(handler);
  }

  train() {} // nothing to learn: the mouse already is the answer
  async clearTraining() {}

  private onMove = (e: MouseEvent) => {
    this.last = { x: e.clientX, y: e.clientY };
  };
}
