import type { ReactNode } from 'react';
import { getOptions } from '../../../app/machine';
import type { Orchestrator } from '../../../app/Orchestrator';
import type { View } from '../../../app/Orchestrator';
import { ErrorBanner, PartnerSaid, PhasePrompt, TypingForm } from './parts';
import { OptionList } from './OptionList';

interface Props {
  orchestrator: Orchestrator;
  view: View;
  draft: string;
  setDraft: (v: string) => void;
  onPick: (i: number) => void;
  /** Buttons for the top bar. */
  topButtons: ReactNode;
  /** Everything under the options (camera, mic, mood, dev panel). */
  extras: ReactNode;
}

/** VERTICAL-only mode: one column, options stacked. Looking up/down steps through them. */
export function StackLayout({
  orchestrator,
  view,
  draft,
  setDraft,
  onPick,
  topButtons,
  extras,
}: Props) {
  const { machine, highlight, dwell } = view;
  return (
    <main className="screen">
      <header className="topbar">
        <PartnerSaid machine={machine} />
        <div className="topbtns">{topButtons}</div>
      </header>
      <ErrorBanner machine={machine} orchestrator={orchestrator} />
      <section className="stage">
        <PhasePrompt machine={machine} />
        {machine.phase === 'typing' ? (
          <TypingForm draft={draft} setDraft={setDraft} orchestrator={orchestrator} />
        ) : (
          <OptionList
            options={getOptions(machine)}
            highlight={highlight}
            dwell={dwell}
            onPick={onPick}
          />
        )}
      </section>
      {extras}
    </main>
  );
}
