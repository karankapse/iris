import { useEffect, useRef, useState } from 'react';
import type { Services } from '../../../app/services';
import { FilteredGaze, type GazeSample } from '../../../core/gaze/FilteredGaze';
import { RealEyeInput } from '../../eye-input';
import { OnlineLearner } from '../../eye-input/real/onlineLearning';
import type { EyeDebugState } from '../../eye-input/real/RealEyeInput';

const HISTORY_MS = 4000;
const PANEL_EVERY_MS = 120; // text refresh rate; the markers move every frame

/**
 * Toggleable debug view (Alt+D, or the Menu): shows WHY the eye control did or didn't act.
 *   grey ring  = raw gaze from the tracker
 *   blue ring  = the face-landmark estimate (after calibration)
 *   red dot    = after head-pose compensation + One Euro smoothing (what the app uses)
 *   dashed circle = the dwell target for the option being looked at (green when inside)
 *   graph      = EAR over the last few seconds with the "closed" threshold line
 * Pointer events pass through, so the app stays usable underneath.
 */
export function GazeDebugOverlay({ services }: { services: Services }) {
  const raw = useRef<HTMLDivElement>(null);
  const landmark = useRef<HTMLDivElement>(null);
  const smooth = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLDivElement>(null);
  const graph = useRef<HTMLCanvasElement>(null);
  const [eye, setEye] = useState<EyeDebugState | null>(null);
  const [gaze, setGaze] = useState<GazeSample | null>(null);

  useEffect(() => {
    const history: { t: number; ear: number | null; closure: number; closed: boolean }[] = [];
    let lastPanel = 0;
    let latestEye: EyeDebugState | null = null;
    let latestGaze: GazeSample | null = null;

    const refreshPanel = () => {
      const now = performance.now();
      if (now - lastPanel < PANEL_EVERY_MS) return;
      lastPanel = now;
      setEye(latestEye);
      setGaze(latestGaze);
    };

    const offGaze =
      services.gaze instanceof FilteredGaze
        ? services.gaze.onSample((s) => {
            latestGaze = s;
            place(raw.current, s.raw.x, s.raw.y);
            if (landmark.current) {
              landmark.current.style.display = s.landmark ? 'block' : 'none';
              if (s.landmark) place(landmark.current, s.landmark.x, s.landmark.y);
            }
            place(smooth.current, s.filtered.x, s.filtered.y);
            refreshPanel();
          })
        : () => {};

    const offEye =
      services.eyeInput instanceof RealEyeInput
        ? services.eyeInput.onDebug((s) => {
            latestEye = s;
            const el = target.current;
            if (el) {
              if (s.target) {
                el.style.display = 'block';
                el.style.width = el.style.height = `${2 * s.target.r}px`;
                place(el, s.target.x - s.target.r, s.target.y - s.target.r);
                el.classList.toggle('inside', s.inTarget);
              } else el.style.display = 'none';
            }
            history.push({ t: s.t, ear: s.ear, closure: s.closure, closed: s.eyesClosed });
            while (history.length && s.t - history[0].t > HISTORY_MS) history.shift();
            drawGraph(graph.current, history, s);
            refreshPanel();
          })
        : () => {};

    return () => {
      offGaze();
      offEye();
    };
  }, [services]);

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const hasGaze = services.gaze instanceof FilteredGaze;

  return (
    <div className="gaze-debug" aria-hidden="true">
      {hasGaze && <div ref={raw} className="dbg-raw" />}
      {hasGaze && <div ref={landmark} className="dbg-landmark" />}
      {hasGaze && <div ref={smooth} className="dbg-smooth" />}
      <div ref={target} className="dbg-target" />

      <section className="dbg-panel">
        <strong>Gaze debug</strong> <span className="muted">(Alt+D to hide)</span>
        <canvas ref={graph} width={260} height={70} />
        <dl>
          <dt>EAR</dt>
          <dd>
            {eye?.ear != null ? eye.ear.toFixed(3) : 'blendshapes'}
            {eye?.ear != null && <> · closed below {eye.earThreshold.toFixed(3)}</>}
          </dd>
          <dt>Closure</dt>
          <dd>
            {eye ? pct(eye.closure) : '—'} (closed ≥ {eye ? pct(eye.blinkClose) : '—'}, open ≤{' '}
            {eye ? pct(eye.blinkOpen) : '—'}) {eye?.eyesClosed && <b className="bad">CLOSED</b>}
          </dd>
          <dt>Blink</dt>
          <dd>
            <Bar value={eye?.blinkProgress ?? 0} />
          </dd>
          <dt>Dwell</dt>
          <dd>
            <Bar value={eye?.dwellProgress ?? 0} />
            {eye && !eye.inTarget && <span className="bad"> outside target</span>}
            {eye && !eye.fixating && <span className="bad"> eyes moving</span>}
          </dd>
          <dt>Zone</dt>
          <dd>
            {eye?.zone ?? '—'}
            {eye && !eye.armed && (
              <span className="muted"> · disarmed (look at the top to re-arm)</span>
            )}
          </dd>
          <dt>Refractory</dt>
          <dd>
            {eye && eye.refractoryLeftMs > 0 ? `${Math.round(eye.refractoryLeftMs)} ms` : 'ready'}
          </dd>
          {hasGaze && (
            <>
              <dt>Gaze</dt>
              <dd>
                raw {gaze ? `${Math.round(gaze.raw.x)}, ${Math.round(gaze.raw.y)}` : '—'} → smooth{' '}
                {gaze ? `${Math.round(gaze.filtered.x)}, ${Math.round(gaze.filtered.y)}` : '—'}
              </dd>
              <dt>Tracker</dt>
              <dd>
                {services.gaze instanceof FilteredGaze && services.gaze.usesPatchModel()
                  ? `own eye-patch model (WebGazer's own: ${
                      gaze?.native
                        ? `${Math.round(gaze.native.x)}, ${Math.round(gaze.native.y)}`
                        : '—'
                    })`
                  : "WebGazer's regression"}
              </dd>
              <dt>Blend</dt>
              <dd>{blendText(services)}</dd>
              <dt>Learned</dt>
              <dd>{learnedText(services)}</dd>
              <dt>Head</dt>
              <dd>
                {gaze?.headDelta
                  ? `yaw ${gaze.headDelta.yaw.toFixed(1)}° · pitch ${gaze.headDelta.pitch.toFixed(1)}°`
                  : 'not compensated (calibrate first)'}
              </dd>
            </>
          )}
        </dl>
        {!(services.eyeInput instanceof RealEyeInput) && (
          <p className="muted">Eye input is the keyboard mock: nothing to show.</p>
        )}
      </section>
    </div>
  );
}

function Bar({ value }: { value: number }) {
  return (
    <span className="dbg-bar">
      <span style={{ width: `${Math.round(Math.min(1, value) * 100)}%` }} />
    </span>
  );
}

function place(el: HTMLElement | null, x: number, y: number) {
  if (el) el.style.transform = `translate(${x}px, ${y}px)`;
}

/** EAR (or closure, when blinks come from blendshapes) over time, with the closed threshold. */
function drawGraph(
  canvas: HTMLCanvasElement | null,
  history: { t: number; ear: number | null; closure: number; closed: boolean }[],
  now: EyeDebugState,
) {
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx || history.length < 2) return;
  const { width: w, height: h } = canvas;
  const useEar = now.ear != null;
  // EAR: 0..0.4 bottom to top (open is high). Closure: 0..1 top to bottom (closed is low).
  const yOf = (p: (typeof history)[number]) =>
    useEar && p.ear != null ? h - (Math.min(0.4, p.ear) / 0.4) * h : p.closure * h;
  const threshold = useEar ? h - (Math.min(0.4, now.earThreshold) / 0.4) * h : now.blinkClose * h;
  const xOf = (t: number) => w - ((now.t - t) / HISTORY_MS) * w;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(240, 136, 62, 0.25)'; // shade where the eyes counted as closed
  for (const p of history) if (p.closed) ctx.fillRect(xOf(p.t), 0, 3, h);
  ctx.strokeStyle = '#f0883e';
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(0, threshold);
  ctx.lineTo(w, threshold);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#58a6ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((p, i) => (i ? ctx.lineTo(xOf(p.t), yOf(p)) : ctx.moveTo(xOf(p.t), yOf(p))));
  ctx.stroke();
}

/** How the two gaze estimates are combined right now (from calibration). */
function blendText(services: Services): string {
  if (!(services.gaze instanceof FilteredGaze)) return '—';
  const cal = services.gaze.calibration();
  if (!cal.landmark) return 'WebGazer only (calibrate to add the landmark estimate)';
  if (!services.gaze.getParams().landmarkFusion) return 'WebGazer only (blending is off)';
  const p = (v: number) => `${Math.round(v * 100)}%`;
  return `WebGazer ${p(cal.weights.x)} / landmarks ${p(1 - cal.weights.x)} left-right · ${p(cal.weights.y)} / ${p(1 - cal.weights.y)} up-down`;
}

/** What was learned beyond calibration: head gains and the drift offset from confirmed use. */
function learnedText(services: Services): string {
  if (!(services.gaze instanceof FilteredGaze)) return '—';
  const { headGainX, headGainY } = services.gaze.getParams();
  const d = services.gaze.driftOffset();
  const n = services.gazeLearning instanceof OnlineLearner ? services.gazeLearning.learned : 0;
  return `head ${headGainX}/${headGainY} px/° · drift ${Math.round(d.x)}, ${Math.round(d.y)} px · ${n} confirmed`;
}
