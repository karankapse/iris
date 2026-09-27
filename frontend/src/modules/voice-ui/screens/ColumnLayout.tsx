import type { ReactNode } from 'react';
import { getOptions } from '../../../app/machine';
import type { Orchestrator, View } from '../../../app/Orchestrator';
import { ColumnOptions } from './OptionList';
import { ErrorBanner, PartnerSaid, PartnerTypeBox, PhasePrompt, TypingForm } from './parts';

interface Props {
  orchestrator: Orchestrator;
  view: View;
  draft: string;
  setDraft: (v: string) => void;
  onPick: (i: number) => void;
  /** The face view and its controls: the floating card on the top right. */
  face: ReactNode;
}

/**
 * FULL eye mode, as drawn:
 *
 *    +----------+----------+----------+
 *    |      [PARTNER SAID]  [ FACE ]  |   <- top half: REST zone. Look here to not choose anything.
 *    |          |          |          |
 *    |    1     |    2     |    3     |   <- the words sit at the bottom; look at them to choose
 *    +----------+----------+----------+
 *
 * Three tall boxes fill the screen (always three: the third is "Other…"). "Partner said" floats over
 * the gap between 1 and 2, the face over the gap between 2 and 3. The split between the rest zone and
 * the columns (LAYOUT.restBottom in contracts/eye.ts) is where the eye input draws the line too.
 */
export function ColumnLayout({ orchestrator, view, draft, setDraft, onPick, face }: Props) {
  const { machine, highlight, dwell } = view;
  return (
    <main className="columns-grid">
      <ErrorBanner machine={machine} orchestrator={orchestrator} floating />
      <ColumnOptions
        options={getOptions(machine)}
        highlight={highlight}
        dwell={dwell}
        onPick={onPick}
      />

      <section className="float-card said-float">
        <PartnerSaid machine={machine} />
        <PhasePrompt machine={machine} />
        {machine.phase === 'typing' && (
          <TypingForm draft={draft} setDraft={setDraft} orchestrator={orchestrator} />
        )}
        {machine.phase === 'listening' && <PartnerTypeBox orchestrator={orchestrator} />}
      </section>

      <section className="float-card face-float">{face}</section>
    </main>
  );
}
