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
  /** App identity, microphone state, and caregiver settings in the upper rest zone. */
  face: ReactNode;
}

/**
 * FULL eye mode, as drawn:
 *
 *    +----------+----------+----------+
 *    |      [PARTNER SAID] [SETTINGS] |   <- top half: REST zone. Look here to not choose anything.
 *    |          |          |          |
 *    |    1     |    2     |    3     |   <- the words sit at the bottom; look at them to choose
 *    +----------+----------+----------+
 *
 * Three tall boxes fill the screen (always three: the third is "Other…"). Conversation and caregiver
 * controls stay in the upper rest zone. The split between the rest zone and
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
