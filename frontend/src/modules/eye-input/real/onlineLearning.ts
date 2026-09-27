// Learning during use: when the person selects an option and then CONFIRMS it (the reply was
// spoken to the end without being stopped), we know where they were looking just before the
// selection: at that option. From a few of those moments we nudge a small drift offset (and,
// optionally, add them as training samples and re-fit the models), so the gaze keeps up with
// slow changes (posture, light, the camera being nudged).
//
// In simulation (a person slowly slumping 4-5 degrees over 2 minutes) column accuracy fell from
// 89% to 65% without it and stayed ~97% with the drift offset; re-fitting alone only reached
// 69% and costs a model fit per confirmation, so it is off by default (onlineRefit).
//
// Safeguards: only the steady part of the look before the selection, only frames with the eyes
// open whose gaze estimate was in the selected box, at most a few samples per selection, at most
// one learning every few seconds, a cap on everything learned this way (oldest dropped first),
// and nothing is ever learned from a selection that was cancelled or not confirmed in time.
import type { FilteredGaze, RecentFrame } from '../../../core/gaze/FilteredGaze';
import type { Zone } from './corners';
import { zoneAt } from './screenZones';

export interface OnlineLearningOptions {
  /** Look at this part of the dwell before the selection (ms): [t - windowMs, t - skipLastMs]. */
  windowMs: number;
  skipLastMs: number;
  /** At most this many samples per confirmed selection. */
  perSelection: number;
  /** At least this long between two learnings (ms). */
  minIntervalMs: number;
  /** At most this many samples learned during use in total (oldest dropped first). */
  maxTotal: number;
  /** Share of the window's gaze that must have been in the selected box. */
  minInBox: number;
  /** A selection must be confirmed within this long (ms), or it is forgotten. */
  confirmWithinMs: number;
  /** Add the moments as training samples and re-fit the models (the drift offset is separate). */
  refit: boolean;
}

export const ONLINE_DEFAULTS: OnlineLearningOptions = {
  windowMs: 1000,
  skipLastMs: 100,
  perSelection: 8,
  minIntervalMs: 5000,
  maxTotal: 400,
  minInBox: 0.8,
  confirmWithinMs: 30000,
  refit: false,
};

interface Pending {
  t: number;
  zone: Zone;
  target: { x: number; y: number };
  frames: RecentFrame[];
}

export class OnlineLearner {
  enabled = true;
  private pending: Pending | null = null;
  private held: Pending | null = null;
  private lastLearnAt = -Infinity;
  /** How many samples were learned so far (for the debug overlay / tests). */
  learned = 0;
  selections = 0;

  constructor(
    private gaze: FilteredGaze,
    private viewport: () => { w: number; h: number } = () => ({
      w: window.innerWidth,
      h: window.innerHeight,
    }),
    public opts: OnlineLearningOptions = { ...ONLINE_DEFAULTS },
  ) {}

  /** The eye input selected the option in `zone`, whose words are at `target` (px), at time t. */
  selected(t: number, zone: Zone, target: { x: number; y: number }) {
    this.pending = null;
    if (!this.enabled || zone === 'center') return;
    const vp = this.viewport();
    const frames = this.gaze
      .recall(t - this.opts.windowMs, t - this.opts.skipLastMs)
      .filter((r) => r.lf || r.tf || r.native); // (blinks were never remembered)
    if (frames.length < 5) return;
    const inBox = frames.filter((r) => zoneAt(r.filtered.x, r.filtered.y, vp) === zone);
    if (inBox.length < this.opts.minInBox * frames.length) return; // not a steady look at it
    const step = Math.max(1, Math.floor(inBox.length / this.opts.perSelection));
    this.pending = {
      t,
      zone,
      target,
      frames: inBox.filter((_, i) => i % step === 0).slice(0, this.opts.perSelection),
    };
    this.selections++;
  }

  /**
   * The app acted on the latest selection (e.g. started speaking the reply): keep it until it is
   * confirmed or discarded. Only a selection made in the last moment counts.
   */
  hold(now: number) {
    this.held = this.pending && now - this.pending.t < 1500 ? this.pending : null;
    this.pending = null;
  }

  /** The held selection was right (the reply was spoken to the end): learn from it. */
  confirm(now: number): number {
    const p = this.held;
    this.held = null;
    if (!p || !this.enabled || now - p.t > this.opts.confirmWithinMs) return 0;
    if (now - this.lastLearnAt < this.opts.minIntervalMs) return 0;
    this.lastLearnAt = now;
    const n = this.gaze.learnFrom(p.frames, p.target.x, p.target.y, {
      maxOnline: this.opts.maxTotal,
      refit: this.opts.refit,
    });
    this.learned += n;
    return n;
  }

  /** The selection was cancelled or undone: never learn from it. */
  discard() {
    this.held = null;
    this.pending = null;
  }
}
