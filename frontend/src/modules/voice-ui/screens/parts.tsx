// Small pieces shared by the two screen layouts (corners and stacked list).
import { useState } from 'react';
import type { Orchestrator } from '../../../app/Orchestrator';
import type { Phase, State } from '../../../app/machine';

export const STATUS: Record<Phase, string> = {
  listening: 'Listening…',
  suggesting: 'Thinking of replies…',
  selectReply: 'Choose a reply',
  moreReplies: 'More replies',
  menu: 'Other options',
  phrases: 'Quick phrases',
  typing: 'Type a reply',
  pickMood: 'Choose a mood',
  confirmTone: 'Speak it in this tone?',
  pickTone: 'Choose a different tone',
  speaking: 'Speaking…',
  feedback: 'Was the tone right?',
};

export function PartnerSaid({ machine }: { machine: State }) {
  return (
    <div className="partner-said">
      <span className="label">Partner said</span>
      <p>{machine.interim || machine.partnerText || '—'}</p>
    </div>
  );
}

export function ErrorBanner({
  machine,
  orchestrator,
  floating = false,
}: {
  machine: State;
  orchestrator: Orchestrator;
  /** Float over the top of the screen (used by the corner layout, which has no spare room). */
  floating?: boolean;
}) {
  if (!machine.error) return null;
  return (
    <div className={floating ? 'error floating' : 'error'} role="alert">
      {machine.error}
      <button onClick={() => orchestrator.dispatch({ type: 'dismiss_error' })}>Dismiss</button>
    </div>
  );
}

const TONE_EMOJIS: Record<string, string> = {
  neutral: '😐',
  happy: '😊',
  excited: '🤩',
  sad: '😔',
  joking: '😏',
  serious: '🧐',
};

/** The big status line, plus the reply and tone while one is being confirmed or spoken. */
export function PhasePrompt({ machine }: { machine: State }) {
  return (
    <>
      <h1 className="status">{STATUS[machine.phase]}</h1>
      {machine.phase === 'typing' && (
        <p className="reply">
          {machine.typed ? `“${machine.typed}”` : 'Look at a group of letters'}
        </p>
      )}
      {['confirmTone', 'pickTone', 'speaking'].includes(machine.phase) && machine.reply && (
        <>
          <p className="reply">“{machine.reply.text}”</p>
          {machine.tone && (
            <p className="tone">
              Tone: <strong>{machine.tone}</strong> {TONE_EMOJIS[machine.tone] ?? ''}
            </p>
          )}
        </>
      )}
    </>
  );
}

/** Caregiver fallback for typing a reply, until the eye keyboard exists. */
export function TypingForm({
  draft,
  setDraft,
  orchestrator,
}: {
  draft: string;
  setDraft: (v: string) => void;
  orchestrator: Orchestrator;
}) {
  return (
    <form
      className="typing"
      onSubmit={(e) => {
        e.preventDefault();
        orchestrator.dispatch({ type: 'custom_reply', text: draft });
        setDraft('');
      }}
    >
      <input
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
  );
}

/** Always visible while listening: type what the partner says (works with or without a microphone). */
export function PartnerTypeBox({ orchestrator }: { orchestrator: Orchestrator }) {
  const [text, setText] = useState('');
  return (
    <form
      className="partner-type"
      onSubmit={(e) => {
        e.preventDefault();
        orchestrator.dispatch({ type: 'partner_final', text });
        setText('');
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type what the partner says, then Enter"
      />
      <button type="submit">Send</button>
    </form>
  );
}
