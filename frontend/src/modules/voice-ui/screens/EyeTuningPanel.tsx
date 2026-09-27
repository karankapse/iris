import { useEffect, useState } from 'react';
import type { Orchestrator } from '../../../app/Orchestrator';
import type { Services } from '../../../app/services';
import type { Settings } from '../../../app/settings';
import {
  DEFAULT_GAZE_FILTER,
  FilteredGaze,
  type GazeFilterParams,
} from '../../../core/gaze/FilteredGaze';
import { RealEyeInput } from '../../eye-input';
import { CalibrationResults } from './CalibrationResults';
import { DEFAULT_TUNING, type EyeTuning } from '../../eye-input/real/tuning';

interface Slider<K extends string> {
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
  help: string;
  show?: (v: number) => string;
}

const ms = (v: number) => `${Math.round(v)} ms`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

const FILTER: Slider<keyof GazeFilterParams>[] = [
  {
    key: 'minCutoff',
    label: 'Min cutoff',
    min: 0.05,
    max: 5,
    step: 0.05,
    help: 'Smoothing when the gaze is still. Lower = steadier dot, slower to settle.',
    show: (v) => `${v.toFixed(2)} Hz`,
  },
  {
    key: 'beta',
    label: 'Beta (speed)',
    min: 0,
    max: 0.05,
    step: 0.0005,
    help: 'How fast smoothing lets go when the eyes move. Higher = less lag on jumps, more jitter.',
    show: (v) => v.toFixed(4),
  },
  {
    key: 'dCutoff',
    label: 'Speed cutoff',
    min: 0.1,
    max: 5,
    step: 0.1,
    help: 'Smoothing of the speed estimate itself. Rarely needs changing.',
    show: (v) => `${v.toFixed(1)} Hz`,
  },
  {
    key: 'headGainX',
    label: 'Head turn compensation',
    min: -60,
    max: 60,
    step: 1,
    help: 'Pixels per degree of head turn. Calibration learns it (0 = the data showed no clear effect). Look at one spot and turn your head: adjust until the dot stays put. Negative if it moves the wrong way.',
    show: (v) => `${v} px/°`,
  },
  {
    key: 'driftRate',
    label: 'Learn during use (drift)',
    min: 0,
    max: 1,
    step: 0.05,
    help: 'After a confirmed selection (reply spoken to the end), move the dot this share of the way toward that option. 0 = off.',
    show: pct,
  },
  {
    key: 'headGainY',
    label: 'Head nod compensation',
    min: -60,
    max: 60,
    step: 1,
    help: 'Same for nodding up/down.',
    show: (v) => `${v} px/°`,
  },
];

/** Tuning keys that the user Settings own (the Settings panel shows the same values). */
const VIA_SETTINGS: Partial<Record<keyof EyeTuning, keyof Settings>> = {
  dwellMs: 'dwellMs',
  selectMs: 'blinkMs',
  regionHoldMs: 'steadinessMs',
};

const GROUPS: { title: string; sliders: Slider<keyof EyeTuning>[] }[] = [
  {
    title: 'Dwell',
    sliders: [
      {
        key: 'dwellMs',
        label: 'Dwell time',
        min: 800,
        max: 4000,
        step: 100,
        help: 'Keep looking this long to select.',
        show: ms,
      },
      {
        key: 'dwellRadius',
        label: 'Target radius',
        min: 0.05,
        max: 0.5,
        step: 0.01,
        help: 'Dwell only fills while the gaze is this close to the option (share of screen width). Leaving resets it.',
        show: pct,
      },
      {
        key: 'dwellGraceMs',
        label: 'Dwell grace',
        min: 0,
        max: 1000,
        step: 25,
        help: 'Leaving the circle (or a blink) for less than this only pauses the dwell; longer resets it.',
        show: ms,
      },
      {
        key: 'fixSpread',
        label: 'Fixation spread',
        min: 0,
        max: 0.4,
        step: 0.01,
        help: 'Dwell only fills while the eyes hold still: the last moments of gaze must fit in a box this big (share of screen width). 0 = off (webcam gaze is noisy: too small and nothing ever selects).',
        show: (v) => (v ? pct(v) : 'off'),
      },
      {
        key: 'regionHoldMs',
        label: 'Zone hold',
        min: 50,
        max: 500,
        step: 25,
        help: 'A new zone must hold this long before it counts (filters flicker).',
        show: ms,
      },
      {
        key: 'refractoryMs',
        label: 'Refractory period',
        min: 0,
        max: 3000,
        step: 50,
        help: 'After any selection, ignore selections for this long (stops doubles).',
        show: ms,
      },
    ],
  },
  {
    title: 'Blink',
    sliders: [
      {
        key: 'earOpen',
        label: 'EAR open (calibrated)',
        min: 0.1,
        max: 0.45,
        step: 0.005,
        help: 'Your Eye Aspect Ratio with eyes open. Set by calibration.',
        show: (v) => v.toFixed(3),
      },
      {
        key: 'earClosed',
        label: 'EAR closed (calibrated)',
        min: 0,
        max: 0.3,
        step: 0.005,
        help: 'Your EAR with eyes closed. Set by calibration.',
        show: (v) => v.toFixed(3),
      },
      {
        key: 'blinkClose',
        label: 'Closed at',
        min: 0.1,
        max: 0.95,
        step: 0.01,
        help: 'Share of the way from open to closed that counts as closed. Higher = must close more fully.',
        show: pct,
      },
      {
        key: 'blinkOpen',
        label: 'Open again at',
        min: 0.05,
        max: 0.9,
        step: 0.01,
        help: 'Must fall below this to count as open again (keep it under "Closed at").',
        show: pct,
      },
      {
        key: 'selectMs',
        label: 'Deliberate blink length',
        min: 300,
        max: 1200,
        step: 50,
        help: 'Closed at least this long = select. Natural blinks are 100-300 ms.',
        show: ms,
      },
      {
        key: 'cancelMs',
        label: 'Hold to cancel',
        min: 800,
        max: 4000,
        step: 50,
        help: 'Eyes closed this long = go back.',
        show: ms,
      },
      {
        key: 'cooldownMs',
        label: 'Blink cooldown',
        min: 0,
        max: 2000,
        step: 50,
        help: 'A blink starting this soon after an action is ignored.',
        show: ms,
      },
      {
        key: 'settleMs',
        label: 'Settle after blink',
        min: 0,
        max: 1000,
        step: 25,
        help: 'Ignore gaze this long after a blink (eyes roll while opening).',
        show: ms,
      },
      {
        key: 'frameGapMs',
        label: 'Face-lost gap',
        min: 100,
        max: 1500,
        step: 50,
        help: 'No frames this long = forget any blink/dwell in progress.',
        show: ms,
      },
    ],
  },
  {
    title: 'Vertical mode',
    sliders: [
      {
        key: 'gazeUp',
        label: 'Up threshold',
        min: -1,
        max: 0,
        step: 0.01,
        help: 'gaze.y at or below this = looking up.',
        show: (v) => v.toFixed(2),
      },
      {
        key: 'gazeDown',
        label: 'Down threshold',
        min: 0,
        max: 1,
        step: 0.01,
        help: 'gaze.y at or above this = looking down.',
        show: (v) => v.toFixed(2),
      },
      {
        key: 'gazeHoldMs',
        label: 'Hold before moving',
        min: 50,
        max: 1500,
        step: 25,
        help: 'Look must hold this long before the highlight moves.',
        show: ms,
      },
      {
        key: 'gazeStepMs',
        label: 'Repeat every',
        min: 200,
        max: 2000,
        step: 50,
        help: 'While held, move again every this many ms.',
        show: ms,
      },
    ],
  },
];

/** Learned by calibration: "Reset" keeps these so you don't have to calibrate again. */
const CALIBRATED: (keyof EyeTuning)[] = [
  'earOpen',
  'earClosed',
  'blinkClose',
  'blinkOpen',
  'gazeUp',
  'gazeDown',
  'useEar',
];

/**
 * Live sliders for every eye-control threshold and gaze-filter constant (Alt+T, or the Menu).
 * Changes apply immediately and are saved; open the debug overlay (Alt+D) alongside to see
 * the effect.
 */
export function EyeTuningPanel({
  services,
  orchestrator,
  settings,
  onClose,
}: {
  services: Services;
  orchestrator: Orchestrator;
  settings: Settings;
  onClose: () => void;
}) {
  const eye = services.eyeInput instanceof RealEyeInput ? services.eyeInput : null;
  const gaze = services.gaze instanceof FilteredGaze ? services.gaze : null;
  const [tuning, setTuning] = useState<EyeTuning | null>(() => eye?.getTuning() ?? null);
  const [filter, setFilter] = useState<GazeFilterParams | null>(() => gaze?.getParams() ?? null);

  // The Settings panel (and calibration) also change some of these: stay in sync.
  useEffect(() => {
    if (eye) setTuning(eye.getTuning());
  }, [eye, settings]);

  const setEye = (partial: Partial<EyeTuning>) => {
    if (!eye) return;
    const viaSettings: Partial<Settings> = {};
    const direct: Partial<EyeTuning> = {};
    for (const [k, v] of Object.entries(partial) as [keyof EyeTuning, number][]) {
      const s = VIA_SETTINGS[k];
      if (s) (viaSettings as Record<string, number>)[s] = v;
      else direct[k] = v;
    }
    if (Object.keys(direct).length) eye.setTuning(direct);
    if (Object.keys(viaSettings).length) orchestrator.setSettings(viaSettings);
    setTuning(eye.getTuning());
  };

  const setGaze = (partial: Partial<GazeFilterParams>) => {
    if (!gaze) return;
    gaze.setParams(partial);
    setFilter(gaze.getParams());
  };

  const resetEye = () => {
    if (!tuning) return;
    const fresh: Partial<EyeTuning> = { ...DEFAULT_TUNING };
    for (const k of CALIBRATED) delete fresh[k];
    setEye(fresh);
  };

  return (
    <aside className="tuning-panel" aria-label="Eye tuning">
      <header>
        <h2>Eye tuning</h2>
        <button onClick={onClose}>Close</button>
      </header>
      <p className="help">Changes apply live and are saved. Alt+D shows the debug overlay.</p>

      {/* how the last eye calibration went (where each look landed, weakest box) */}
      {eye?.lastCalibration() && (
        <details>
          <summary>Last calibration</summary>
          <CalibrationResults report={eye.lastCalibration()!} />
        </details>
      )}

      {filter && (
        <details open>
          <summary>Gaze filter</summary>
          <label className="check">
            <input
              type="checkbox"
              checked={filter.landmarkFusion === 1}
              onChange={(e) => setGaze({ landmarkFusion: e.target.checked ? 1 : 0 })}
            />{' '}
            Blend in the face-landmark gaze estimate (after calibration)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={filter.patchModel === 1}
              onChange={(e) => setGaze({ patchModel: e.target.checked ? 1 : 0 })}
            />{' '}
            Own eye-patch model (off = WebGazer&apos;s built-in regression)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={filter.skipBlinks === 1}
              onChange={(e) => setGaze({ skipBlinks: e.target.checked ? 1 : 0 })}
            />{' '}
            Ignore the tracker while the eyes are closed
          </label>
          {FILTER.map((s) => (
            <Row
              key={s.key}
              s={s}
              value={filter[s.key]}
              onChange={(v) => setGaze({ [s.key]: v })}
            />
          ))}
          <button className="linkbtn small" onClick={() => setGaze(DEFAULT_GAZE_FILTER)}>
            Reset filter
          </button>
        </details>
      )}

      {tuning ? (
        <>
          {GROUPS.map((g) => (
            <details key={g.title} open={g.title !== 'Vertical mode'}>
              <summary>{g.title}</summary>
              {g.title === 'Blink' && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={tuning.useEar === 1}
                    onChange={(e) => setEye({ useEar: e.target.checked ? 1 : 0 })}
                  />{' '}
                  Use Eye Aspect Ratio (off = MediaPipe blink scores)
                </label>
              )}
              {g.sliders.map((s) => (
                <Row
                  key={s.key}
                  s={s}
                  value={tuning[s.key]}
                  onChange={(v) => setEye({ [s.key]: v })}
                />
              ))}
            </details>
          ))}
          <details>
            <summary>Learning</summary>
            <label className="check">
              <input
                type="checkbox"
                checked={tuning.onlineLearning === 1}
                onChange={(e) => setEye({ onlineLearning: e.target.checked ? 1 : 0 })}
              />{' '}
              Learn from confirmed selections (a reply chosen with the eyes and spoken to the end)
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={tuning.onlineRefit === 1}
                onChange={(e) => setEye({ onlineRefit: e.target.checked ? 1 : 0 })}
              />{' '}
              ...also add them as training samples and re-fit the models (slower)
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={tuning.calLearnFromCheck === 1}
                onChange={(e) => setEye({ calLearnFromCheck: e.target.checked ? 1 : 0 })}
              />{' '}
              Calibration: also learn from the check dots (after measuring them)
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={tuning.calLearnHeadGain === 1}
                onChange={(e) => setEye({ calLearnHeadGain: e.target.checked ? 1 : 0 })}
              />{' '}
              Calibration: learn the head turn / nod compensation (off = keep the sliders)
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={tuning.calHeadStep === 1}
                onChange={(e) => setEye({ calHeadStep: e.target.checked ? 1 : 0 })}
              />{' '}
              Calibration: extra step &quot;keep looking at the dot and slowly turn your head&quot;
            </label>
          </details>
          <button className="linkbtn small" onClick={resetEye}>
            Reset thresholds (keeps calibration)
          </button>
        </>
      ) : (
        <p className="muted">Eye input is the keyboard mock: nothing to tune.</p>
      )}
    </aside>
  );
}

function Row<K extends string>({
  s,
  value,
  onChange,
}: {
  s: Slider<K>;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span className="slider-head">
        <strong>{s.label}</strong>
        <span>{s.show ? s.show(value) : value}</span>
      </span>
      <input
        type="range"
        min={s.min}
        max={s.max}
        step={s.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="help">{s.help}</span>
    </label>
  );
}
