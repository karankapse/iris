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
  /** Small camera thumbnail + menu button, shown in the right of the middle band. */
  sidebar: ReactNode;
}

/**
 * FULL mode: the screen is a 2x2 grid. Up to four options sit in the four CORNERS (look at a
 * corner to choose it). A band across the middle shows what was said, the status and your
 * face, and is the "rest" area: look there when you don't want to choose anything.
 * Row sizes (36% / 28% / 36%) match TARGET_POSITION in contracts/eye.ts, so the calibration
 * dots appear exactly where the cards are.
 */
export function CornerLayout({ orchestrator, view, draft, setDraft, onPick, sidebar }: Props) {
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

      <section className="mid">
        <div className="mid-left">
          <PartnerSaid machine={machine} />
        </div>
        <div className="mid-center">
          <PhasePrompt machine={machine} />
          {machine.phase === 'typing' && (
            <TypingForm draft={draft} setDraft={setDraft} orchestrator={orchestrator} />
          )}
          {machine.phase === 'listening' && <PartnerTypeBox orchestrator={orchestrator} />}
          {options.length > 0 && <p className="rest-hint">● look here to rest</p>}
        </div>
        <div className="mid-right">{sidebar}</div>
      </section>
    </main>
  );
}
