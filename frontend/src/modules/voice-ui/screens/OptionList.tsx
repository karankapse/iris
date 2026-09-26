import { optionRegions } from '../../../contracts';
import type { Region } from '../../../contracts';
import type { Option } from '../../../app/machine';

interface Props {
  options: Option[];
  /** Which option the eyes are on, and how far the dwell timer has filled (0..1). */
  highlight: number | null;
  dwell: number;
  /** Mouse/touch fallback for caregivers and for development. */
  onPick: (index: number) => void;
}

function Card({
  option,
  index,
  highlighted,
  dwell,
  onPick,
  className,
  style,
}: {
  option: Option;
  index: number;
  highlighted: boolean;
  dwell: number;
  onPick: (i: number) => void;
  className: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      className={`${className} ${highlighted ? 'highlighted' : ''}`}
      style={style}
      onClick={() => onPick(index)}
    >
      <span className="option-number">{index + 1}</span>
      <span className="option-label">{option.label}</span>
      {option.hint && <span className="option-hint">{option.hint}</span>}
      {highlighted && dwell > 0 && <span className="dwell" style={{ width: `${dwell * 100}%` }} />}
    </button>
  );
}

/**
 * VERTICAL mode: BIG stacked targets, one per row. Looking up/down moves the highlight.
 */
export function OptionList({ options, highlight, dwell, onPick }: Props) {
  return (
    <ul className="options" data-count={options.length}>
      {options.map((option, i) => (
        <li key={`${i}-${option.label}`}>
          <Card
            option={option}
            index={i}
            highlighted={highlight === i}
            dwell={dwell}
            onPick={onPick}
            className="option"
          />
        </li>
      ))}
    </ul>
  );
}

/** CSS grid-area name for each corner (defined in styles.css: .corner-grid). */
const AREA: Record<Region, string> = {
  'up-left': 'tl',
  'up-right': 'tr',
  'down-left': 'bl',
  'down-right': 'br',
};

/**
 * FULL mode: each option is drawn in the screen corner you look at to choose it. The positions
 * come from `optionRegions`, the same function the eye input uses, so they always agree.
 * These cards are placed into the parent's `.corner-grid`.
 */
export function CornerOptions({ options, highlight, dwell, onPick }: Props) {
  const regions = optionRegions(options.length, 'full');
  return (
    <>
      {options.map((option, i) => (
        <Card
          key={`${i}-${option.label}`}
          option={option}
          index={i}
          highlighted={highlight === i}
          dwell={dwell}
          onPick={onPick}
          className="corner-card"
          style={{ gridArea: AREA[regions[i]] }}
        />
      ))}
    </>
  );
}
