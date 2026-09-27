import { useEffect, useState } from 'react';
import { openChannel, type PartnerAction, type PartnerViewMessage } from '../../../app/partnerLink';

const STATUS: Record<PartnerViewMessage['phase'], string> = {
  listening: 'Listening to you…',
  suggesting: 'Getting reply ideas…',
  selectReply: 'Choosing a reply…',
  moreReplies: 'Choosing a reply…',
  menu: 'Choosing what to do…',
  phrases: 'Choosing a quick phrase…',
  typing: 'Typing a reply…',
  quickType: 'Typing a reply (first letters)…',
  qtMore: 'Typing a reply…',
  pickMood: 'Choosing a mood…',
  confirmTone: 'Choosing how to say it…',
  pickTone: 'Choosing how to say it…',
  speaking: 'Speaking…',
  feedback: 'Waiting for their answer…',
};

/**
 * What the conversation partner sees (open it in a second window: /partner).
 * Big text, and two big buttons to say whether the reply's tone landed.
 */
export function PartnerView() {
  const [msg, setMsg] = useState<PartnerViewMessage | null>(null);
  const [reacted, setReacted] = useState<string | null>(null);

  useEffect(() => {
    const channel = openChannel();
    if (!channel) return;
    channel.onmessage = (e: MessageEvent<PartnerViewMessage>) => {
      if (e.data.type !== 'view') return;
      // A new reply means a new chance to react.
      setMsg((prev) => {
        if (prev?.lastSpoken?.id !== e.data.lastSpoken?.id) setReacted(null);
        return e.data;
      });
    };
    const hello: PartnerAction = { type: 'hello' };
    channel.postMessage(hello); // ask the main window for the current state
    return () => channel.close();
  }, []);

  const react = (reaction: 'understood' | 'seemed_off') => {
    const channel = openChannel();
    const action: PartnerAction = { type: 'reaction', reaction };
    channel?.postMessage(action);
    channel?.close();
    setReacted(reaction);
  };

  if (!msg) {
    return (
      <main className="screen partner">
        <h1 className="status">Waiting for the main Iris window…</h1>
      </main>
    );
  }

  return (
    <main className="screen partner">
      <p className="status">{STATUS[msg.phase]}</p>

      {msg.phase === 'typing' && (
        <section>
          <span className="label">They are typing…</span>
          <p className="big typing-live">{msg.typed || '…'}</p>
        </section>
      )}

      <section>
        <span className="label">You said</span>
        <p className="big">{msg.interim || msg.partnerText || '—'}</p>
      </section>

      {msg.lastSpoken && (
        <section>
          <span className="label">
            They replied <em>({msg.lastSpoken.tone})</em>
          </span>
          <p className="big reply">“{msg.lastSpoken.text}”</p>
          <div className="reactions">
            <button
              className={`reaction good ${reacted === 'understood' ? 'picked' : ''}`}
              onClick={() => react('understood')}
            >
              👍 Understood
            </button>
            <button
              className={`reaction bad ${reacted === 'seemed_off' ? 'picked' : ''}`}
              onClick={() => react('seemed_off')}
            >
              🤔 Seemed off
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
