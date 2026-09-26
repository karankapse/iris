import type { CSSProperties } from 'react';
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
  style?: CSSProperties;
}) {
  // Info cards fill a slot (so there is never a blank) but cannot be chosen.
  const classes = [
    className,
    highlighted && !option.info ? 'highlighted' : '',
    option.info ? 'info' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      className={classes}
      style={style}
      onClick={() => !option.info && onPick(index)}
      aria-disabled={option.info || undefined}
    >
      <span className="option-text">
        {!option.info && <span className="option-number">{index + 1}</span>}
        <span className="option-label">{option.label}</span>
        {option.hint && <span className="option-hint">{option.hint}</span>}
      </span>
      {highlighted && dwell > 0 && !option.info && (
        <span className="dwell" style={{ width: `${dwell * 100}%` }} />
      )}
    </button>
  );
}

/** VERTICAL mode: BIG stacked targets, one per row. Looking up/down moves the highlight. */
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

/** CSS grid column for each region (see styles.css: .columns-grid). */
const COLUMN: Record<Region, number> = { left: 1, middle: 2, right: 3 };

/**
 * FULL mode: three tall columns. Each option's box stretches from the top of the screen to the
 * bottom, and its words sit at the BOTTOM: you choose by looking at the words. The positions come
 * from `optionRegions`, the same function the eye input uses, so they always agree.
 */
export function ColumnOptions({ options, highlight, dwell, onPick }: Props) {
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
          className="column-card"
          style={{ gridColumn: COLUMN[regions[i]], gridRow: 1 }}
        />
      ))}
    </>
  );
}
