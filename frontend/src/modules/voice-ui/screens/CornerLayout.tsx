import type { ReactNode } from 'react';
import { getOptions } from '../../../app/machine';
import type { Orchestrator, View } from '../../../app/Orchestrator';
import { CornerOptions } from './OptionList';
import { ErrorBanner, PartnerSaid, PartnerTypeBox, PhasePrompt, TypingForm } from './parts';

interface Props {
  orchestrator: Orchestrator;
  view: View;
  draft: string;
  setDraft: (v: string) => void;
  onPick: (i: number) => void;
  /** The face view and its controls: shown in the middle-top cell. */
  face: ReactNode;
}

/**
 * FULL eye mode. The screen is three columns and two rows:
 *
 *      +--------+---------+--------+
 *      |   1    |  FACE   |   2    |
 *      +--------+---------+--------+
 *      |   3    | PARTNER |   4    |
 *      |        |  SAID   |        |
 *      +--------+---------+--------+
 *
 * The four options sit in the four corners: look at one to choose it. The middle column is the
 * REST position: the face view is the centre of the screen, so looking at it (or at "Partner
 * said") means "not choosing anything". The column widths (36/28/36 %) and two equal rows match
 * TARGET_POSITION in contracts/eye.ts, so the calibration dots appear exactly where the boxes are.
 */
export function CornerLayout({ orchestrator, view, draft, setDraft, onPick, face }: Props) {
  const { machine, highlight, dwell } = view;
  const options = getOptions(machine);
  return (
    <main className="corner-grid">
      <ErrorBanner machine={machine} orchestrator={orchestrator} floating />
      <CornerOptions options={options} highlight={highlight} dwell={dwell} onPick={onPick} />
      {options.length === 0 &&
        (['tl', 'tr', 'bl', 'br'] as const).map((area) => (
          <div key={area} className="corner-ghost" style={{ gridArea: area }}>
            Options appear here
          </div>
        ))}

      <section className="face-cell">{face}</section>

      <section className="said-cell">
        <PartnerSaid machine={machine} />
        <PhasePrompt machine={machine} />
        {machine.phase === 'typing' && (
          <TypingForm draft={draft} setDraft={setDraft} orchestrator={orchestrator} />
        )}
        {machine.phase === 'listening' && <PartnerTypeBox orchestrator={orchestrator} />}
      </section>
    </main>
  );
}
