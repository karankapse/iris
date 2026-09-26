import type { Option } from '../../../app/machine';

interface Props {
  options: Option[];
  /** Which option the eyes are on, and how far the dwell timer has filled (0..1). */
  highlight: number | null;
  dwell: number;
  /** Mouse/touch fallback for caregivers and for development. */
  onPick: (index: number) => void;
}

/**
 * BIG stacked targets. Webcam gaze is imprecise, so: at most 4 options, each one tall and
 * full-width. Vertical stacking also works for "vertical-only" eye mode (up/down).
 */
export function OptionList({ options, highlight, dwell, onPick }: Props) {
  return (
    <ul className="options" data-count={options.length}>
      {options.map((option, i) => (
        <li key={`${i}-${option.label}`}>
          <button
            className={`option ${highlight === i ? 'highlighted' : ''}`}
            onClick={() => onPick(i)}
          >
            <span className="option-number">{i + 1}</span>
            <span className="option-label">{option.label}</span>
            {option.hint && <span className="option-hint">{option.hint}</span>}
            {highlight === i && dwell > 0 && (
              <span className="dwell" style={{ width: `${dwell * 100}%` }} />
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
