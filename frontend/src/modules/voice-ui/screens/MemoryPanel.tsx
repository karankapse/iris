import { useEffect, useState } from 'react';
import type { Orchestrator } from '../../../app/Orchestrator';
import type { Settings } from '../../../app/settings';
import { api } from '../../../core/api';
import type { components } from '../../../shared/api.generated';

type Memory = components['schemas']['MemoryResponse'];
const USER = 'local-user';

/**
 * What Iris remembers about past conversations, and the switch to turn it off. Each entry is
 * one moment: what the partner said, how the user's face reacted, what they replied. Similar
 * moments are shown to Claude so suggestions match how this person tends to feel.
 */
export function MemoryPanel({
  orchestrator,
  settings,
}: {
  orchestrator: Orchestrator;
  settings: Settings;
}) {
  const [memory, setMemory] = useState<Memory | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    api
      .getMemory(USER, 5)
      .then((m) => {
        setMemory(m);
        setError(null);
      })
      .catch(() => setError('The backend is not reachable, so nothing is remembered right now.'));

  useEffect(() => {
    void refresh();
  }, []);

  const forget = async () => {
    if (!window.confirm('Forget every remembered conversation? This cannot be undone.')) return;
    await api.forgetMemory(USER).catch(() => null);
    void refresh();
  };

  return (
    <section className="memory-panel">
      <h3>Conversation memory</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.rememberConversations}
          onChange={(e) => orchestrator.setSettings({ rememberConversations: e.target.checked })}
        />{' '}
        Remember conversations to learn how I feel about each topic
      </label>
      <p className="help">
        Stored only on this computer: what was said to you, how your face reacted, and your reply.
        When something similar is said again, suggestions lean toward how you usually felt.
      </p>
      {error && <p className="help">{error}</p>}
      {memory && (
        <>
          <p className="help">
            Remembering {memory.count} moment{memory.count === 1 ? '' : 's'}.
          </p>
          <ul className="memory-list">
            {memory.entries.map((e, i) => (
              <li key={i}>
                <span className="muted">“{e.partner_text}”</span> → felt{' '}
                <strong>{e.detected_emotion ?? '?'}</strong> → “{e.reply_text}” ({e.reply_tone}
                {e.tone_ok === false ? ', tone felt wrong' : ''})
              </li>
            ))}
          </ul>
          <div className="drawer-buttons">
            <button className="linkbtn small" onClick={() => void refresh()}>
              Refresh
            </button>
            {memory.count > 0 && (
              <button className="linkbtn small" onClick={() => void forget()}>
                Forget everything
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
