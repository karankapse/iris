import { LAYOUT } from '../../../contracts';
import type { CalibrationReport } from '../../eye-input/real/screenCalibration';

const ZONE_LABEL = {
  center: 'Rest (top)',
  left: 'Left',
  middle: 'Middle',
  right: 'Right',
} as const;

/** Which box a reading (screen fractions) falls in: same geometry as the app. */
function zoneOf(x: number, y: number) {
  if (y < LAYOUT.restBottom) return 'center';
  if (x < LAYOUT.leftColumn) return 'left';
  if (x > LAYOUT.rightColumn) return 'right';
  return 'middle';
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * What the last calibration measured, drawn as a mini screen: each check dot (ring) and where the
 * gaze actually landed while looking at it (green = in the right box, orange = not).
 */
export function CalibrationResults({ report }: { report: CalibrationReport }) {
  const aspect = report.viewport.w / report.viewport.h;
  const weakest = (Object.entries(report.zones) as [keyof typeof ZONE_LABEL, number][]).sort(
    (a, b) => a[1] - b[1],
  )[0];
  return (
    <div className="calib-results">
      <div className="calib-map" style={{ aspectRatio: String(aspect) }}>
        <div className="calib-map-rest" style={{ height: `${LAYOUT.restBottom * 100}%` }} />
        <div className="calib-map-col" style={{ left: `${LAYOUT.leftColumn * 100}%` }} />
        <div className="calib-map-col" style={{ left: `${LAYOUT.rightColumn * 100}%` }} />
        {report.points.map((p, i) => (
          <div key={i}>
            {p.readings.map((r, j) => (
              <span
                key={j}
                className={`calib-map-reading ${zoneOf(r.x, r.y) === p.zone ? 'hit' : 'miss'}`}
                style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%` }}
              />
            ))}
            <span
              className="calib-map-target"
              style={{ left: `${p.target.x}%`, top: `${p.target.y}%` }}
            />
          </div>
        ))}
      </div>

      <ul className="calib-zones">
        {(Object.keys(ZONE_LABEL) as (keyof typeof ZONE_LABEL)[]).map((z) => (
          <li key={z} className={report.zones[z] < 0.7 ? 'weak' : ''}>
            <strong>{pct(report.zones[z])}</strong> {ZONE_LABEL[z]}
          </li>
        ))}
      </ul>
      <p className="help">
        Overall {pct(report.overall)} of readings landed in the right box. Left-right error on the
        answer row: about {Math.round(report.horizontalErrorPx)} px (a column is{' '}
        {Math.round(report.viewport.w / 3)} px wide).
        {report.weights &&
          ` Left-right uses WebGazer ${pct(report.weights.x)} + face landmarks ${pct(1 - report.weights.x)}.`}
        {report.rawErrorPx !== undefined &&
          (report.correctionUsed
            ? ` Correction: average error ${Math.round(report.rawErrorPx)} px → ${Math.round(report.finalErrorPx)} px.`
            : ' The correction did not help this time, so the plain tracker is used.')}
        {report.retried.length > 0 &&
          ` Re-trained: ${report.retried.map((z) => ZONE_LABEL[z].toLowerCase()).join(', ')}.`}
        {report.headGain &&
          (report.headGain.gainX || report.headGain.gainY
            ? ` Head compensation learned: ${Math.round(report.headGain.gainX)} px/° turn, ${Math.round(report.headGain.gainY)} px/° nod.`
            : ' Head compensation: off (the head hardly moved, or it made no clear difference).')}
      </p>
      {report.overall < 0.8 && weakest && (
        <p className="help">
          Weakest: {ZONE_LABEL[weakest[0]].toLowerCase()}. For a better result: light on your face
          (not behind you), sit still about an arm's length away, and keep your head still while
          your eyes follow the dots.
          {report.positionIssue && ` Position: ${report.positionIssue.toLowerCase()}.`}
        </p>
      )}
    </div>
  );
}
