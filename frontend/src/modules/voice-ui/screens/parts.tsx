// Small pieces shared by the two screen layouts (corners and stacked list).
import { useEffect, useRef, useState } from 'react';
import type { Orchestrator } from '../../../app/Orchestrator';
import type { Phase, State } from '../../../app/machine';

export const STATUS: Record<Phase, string> = {
  listening: 'Listening…',
  suggesting: 'Measuring reaction & getting replies…',
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
  // Long turns scroll inside a small box; new words keep it scrolled to the latest line
  // (unless the reader has scrolled up to read something earlier).
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const text = `${machine.interim}|${machine.partnerText}|${machine.heldPartner}`;
  useEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [text]);
  const onScroll = () => {
    const el = box.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
  };

  return (
    <div className="partner-said">
      <span className="label">Partner said</span>
      <div className="said-scroll" ref={box} onScroll={onScroll} tabIndex={0}>
        {machine.phase === 'listening' || machine.phase === 'suggesting' ? (
          <p>{machine.interim || machine.partnerText || '—'}</p>
        ) : (
          <>
            {/* busy choosing a reply: keep what they're answering; newer speech waits below */}
            <p>{machine.partnerText || '—'}</p>
            {/* only finished sentences, not live words, so it doesn't keep growing on screen */}
            {machine.heldPartner && <p className="also-said">Also said: {machine.heldPartner}</p>}
          </>
        )}
      </div>
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
      {machine.phase === 'selectReply' && machine.measuredEmotion && (
        <p className="tone">
          Reaction tone: <strong>{machine.measuredEmotion}</strong>{' '}
          {TONE_EMOJIS[machine.measuredEmotion] ?? ''}
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
