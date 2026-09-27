// Fixation detection by dispersion (I-DT, Salvucci & Goldberg 2000): the eyes are FIXATING when
// every gaze point of the last `windowMs` fits in a small box; otherwise they are moving
// (a saccade, or drifting across the screen). Dwell only counts during fixations, so sweeping
// the eyes over an option doesn't fill its timer.

export class FixationDetector {
  private points: { t: number; x: number; y: number }[] = [];

  /**
   * @param windowMs    how much recent gaze to look at
   * @param maxSpreadPx largest (width + height) of the box around those points that is still a
   *                    fixation. 0 = detection off (always "fixating").
   */
  constructor(
    public windowMs: number,
    public maxSpreadPx: number,
  ) {}

  push(t: number, x: number, y: number) {
    this.points.push({ t, x, y });
    while (this.points.length && t - this.points[0].t > this.windowMs) this.points.shift();
  }

  /** Are the eyes holding still right now? (Needs most of a window of points first.) */
  get fixating(): boolean {
    if (this.maxSpreadPx <= 0) return true;
    const pts = this.points;
    if (pts.length < 2 || pts[pts.length - 1].t - pts[0].t < this.windowMs * 0.6) return false;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    return maxX - minX + (maxY - minY) <= this.maxSpreadPx;
  }

  reset() {
    this.points = [];
  }
}
