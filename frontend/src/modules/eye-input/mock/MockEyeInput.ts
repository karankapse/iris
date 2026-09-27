import type { EyeEvent, EyeInput, EyeMode } from '../../../contracts';
import { createEmitter } from '../../../core/emitter';

/**
 * Keyboard stand-in for the webcam, so everyone can develop without a camera:
 *
 *   ↑ ↓ ← →      move the highlight       (= looking at another option/corner)
 *   Space        select highlighted option (= a deliberate blink / dwell finished)
 *   1 – 4        select that option directly
 *   Enter        confirm                   (= "yes")
 *   Esc / Backspace  cancel                (= "no" / go back)
 *
 * The real EyeInput must emit exactly the same events (see contracts/eye.ts).
 */
export class MockEyeInput implements EyeInput {
  private emitter = createEmitter<EyeEvent>();
  private optionCount = 0;
  private highlighted: number | null = null;
  private running = false;

  start(options: { mode: EyeMode; optionCount: number }) {
    this.running = true;
    this.setOptionCount(options.optionCount);
    window.addEventListener('keydown', this.onKey);
  }

  setOptionCount(optionCount: number) {
    this.optionCount = optionCount;
    this.setHighlight(optionCount > 0 ? 0 : null);
  }

  stop() {
    this.running = false;
    window.removeEventListener('keydown', this.onKey);
  }

  async calibrate() {
    // Nothing to calibrate for a keyboard.
    return [];
  }

  on(handler: (event: EyeEvent) => void) {
    return this.emitter.on(handler);
  }

  private setHighlight(index: number | null) {
    this.highlighted = index;
    this.emitter.emit({ type: 'highlight', optionIndex: index, dwellProgress: 0 });
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.running) return;
    // Native controls own their keys; Enter/Space must not also select a gaze option.
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        'input, textarea, select, button, a, summary, dialog, [contenteditable="true"]',
      )
    )
      return;

    const handled = () => e.preventDefault();

    if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && this.optionCount > 0) {
      handled();
      this.setHighlight(Math.min(this.optionCount - 1, (this.highlighted ?? -1) + 1));
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && this.optionCount > 0) {
      handled();
      this.setHighlight(Math.max(0, (this.highlighted ?? 1) - 1));
    } else if (e.key === ' ' && this.highlighted !== null) {
      handled();
      this.emitter.emit({ type: 'select', optionIndex: this.highlighted });
    } else if (/^[1-4]$/.test(e.key) && Number(e.key) <= this.optionCount) {
      handled();
      this.emitter.emit({ type: 'select', optionIndex: Number(e.key) - 1 });
    } else if (e.key === 'Enter') {
      handled();
      this.emitter.emit({ type: 'confirm' });
    } else if (e.key === 'Escape' || e.key === 'Backspace') {
      handled();
      this.emitter.emit({ type: 'cancel' });
    }
  };
}
