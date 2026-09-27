// Small pieces shared by the two screen layouts (corners and stacked list).
import { useState } from 'react';
import type { Orchestrator } from '../../../app/Orchestrator';
import type { Phase, State } from '../../../app/machine';

export const STATUS: Record<Phase, string> = {
  listening: 'Listening…',
  suggesting: 'Preparing replies…',
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
      <p>{machine.interim || machine.partnerText || 'Waiting for your partner…'}</p>
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

/** The big status line, plus the reply and tone while one is being confirmed or spoken. */
export function PhasePrompt({ machine }: { machine: State }) {
  return (
    <>
      <h1 className="status" role="status" aria-live="polite">
        {STATUS[machine.phase]}
      </h1>
      {machine.phase === 'selectReply' && machine.measuredEmotion && (
        <p className="tone">
          Reaction tone: <strong>{machine.measuredEmotion}</strong>
        </p>
      )}
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
              Tone: <strong>{machine.tone}</strong>
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
        aria-label="Type a reply"
        placeholder="Type a reply"
      />
      <button type="submit" disabled={!draft.trim()}>
        Use this reply
      </button>
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
        aria-label="Partner’s message"
        placeholder="Type your partner’s message"
      />
      <button type="submit" disabled={!text.trim()}>
        Send
      </button>
    </form>
  );
}
