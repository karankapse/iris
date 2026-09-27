import type { Orchestrator } from '../../../app/Orchestrator';
import { DEFAULT_SETTINGS, SETTING_LIMITS, type Settings } from '../../../app/settings';

type SliderKey = keyof typeof SETTING_LIMITS;

const SLIDERS: { key: SliderKey; label: string; help: string; show: (v: number) => string }[] = [
  {
    key: 'dwellMs',
    label: 'Dwell time',
    help: 'How long to keep looking at a box to select it. Longer = fewer accidental selections.',
    show: (v) => `${(v / 1000).toFixed(1)} s`,
  },
  {
    key: 'blinkMs',
    label: 'Blink length',
    help: 'How long a blink must last to count as a deliberate "select". Natural blinks are shorter.',
    show: (v) => `${(v / 1000).toFixed(2)} s`,
  },
  {
    key: 'steadinessMs',
    label: 'Gaze steadiness',
    help: 'How long a look must hold on a box before it counts. Higher = steadier but slower.',
    show: (v) => `${v} ms`,
  },
  {
    key: 'speechSpeed',
    label: 'Speech speed',
    help: 'How fast the reply is spoken.',
    show: (v) => `${v.toFixed(2)}×`,
  },
];

/** Abilities vary and change over time, so everything about how the eyes control the app is adjustable. */
export function SettingsPanel({
  orchestrator,
  settings,
}: {
  orchestrator: Orchestrator;
  settings: Settings;
}) {
  return (
    <section className="panel settings">
      <h3>Settings</h3>
      {SLIDERS.map(({ key, label, help, show }) => {
        const [min, max, step] = SETTING_LIMITS[key];
        return (
          <label key={key} className="slider">
            <span className="slider-head">
              <strong>{label}</strong>
              <span>{show(settings[key])}</span>
            </span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={settings[key]}
              onChange={(e) => orchestrator.setSettings({ [key]: Number(e.target.value) })}
            />
            <span className="help">{help}</span>
          </label>
        );
      })}
      <label className="check">
        <input
          type="checkbox"
          checked={settings.doubleBlinkBack}
          onChange={(e) => orchestrator.setSettings({ doubleBlinkBack: e.target.checked })}
        />
        <span>
          <strong>Double blink = go back</strong>
          <span className="help">
            Off by default: people sometimes blink twice without meaning anything.
          </span>
        </span>
      </label>
      <button onClick={() => orchestrator.setSettings(DEFAULT_SETTINGS)}>Reset to defaults</button>
    </section>
  );
}
