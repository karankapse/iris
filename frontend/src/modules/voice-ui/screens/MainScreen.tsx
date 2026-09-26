import { useState } from 'react';
import { getOptions } from '../../../app/machine';
import type { Phase } from '../../../app/machine';
import type { Services } from '../../../app/services';
import { useOrchestrator } from '../../../app/useOrchestrator';
import { DevPanel } from './DevPanel';
import { MoodBar } from './MoodBar';
import { OptionList } from './OptionList';

const STATUS: Record<Phase, string> = {
  listening: 'Listening…',
  suggesting: 'Thinking of replies…',
  selectReply: 'Choose a reply',
  typing: 'Type a reply',
  confirmTone: 'Speak it in this tone?',
  pickTone: 'Choose a different tone',
  speaking: 'Speaking…',
  feedback: 'Was the tone right?',
};

/** The main user screen. Everything the user sees is large and high-contrast on purpose. */
export function MainScreen({ services }: { services: Services }) {
  const { orchestrator, view } = useOrchestrator(services);
  const { machine, highlight, dwell, eyeMode } = view;
  const [draft, setDraft] = useState('');
  const options = getOptions(machine);

  const pick = (optionIndex: number) =>
    orchestrator.dispatch({ type: 'eye', event: { type: 'select', optionIndex } });

  return (
    <main className="screen">
      <header className="topbar">
        <div className="partner-said">
          <span className="label">Partner said</span>
          <p>{machine.interim || machine.partnerText || '—'}</p>
        </div>
        <button
          className="linkbtn"
          onClick={() => window.open('/partner', 'iris-partner', 'width=900,height=700')}
        >
          Open partner view ↗
        </button>
      </header>

      {machine.error && (
        <div className="error" role="alert">
          {machine.error}
          <button onClick={() => orchestrator.dispatch({ type: 'dismiss_error' })}>Dismiss</button>
        </div>
      )}

      <section className="stage">
        <h1 className="status">{STATUS[machine.phase]}</h1>

        {['confirmTone', 'pickTone', 'speaking'].includes(machine.phase) && machine.reply && (
          <>
            <p className="reply">“{machine.reply.text}”</p>
            {machine.tone && <p className="tone">Tone: {machine.tone}</p>}
          </>
        )}

        {machine.phase === 'typing' ? (
          <form
            className="typing"
            onSubmit={(e) => {
              e.preventDefault();
              orchestrator.dispatch({ type: 'custom_reply', text: draft });
              setDraft('');
            }}
          >
            {/* TODO(Voice & UI): replace with the eye-controlled keyboard (starter issue). */}
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Caregiver can type here for now"
            />
            <button type="submit">Use this reply</button>
            <button
              type="button"
              onClick={() => orchestrator.dispatch({ type: 'eye', event: { type: 'cancel' } })}
            >
              Back
            </button>
          </form>
        ) : (
          <OptionList options={options} highlight={highlight} dwell={dwell} onPick={pick} />
        )}
      </section>

      <MoodBar
        mood={machine.mood}
        eyeMode={eyeMode}
        onMood={(m) => orchestrator.setMood(m)}
        onEyeMode={(m) => orchestrator.setEyeMode(m)}
      />
      <DevPanel mocks={services.mocks} />
    </main>
  );
}
