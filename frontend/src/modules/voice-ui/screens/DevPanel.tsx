import { useState } from 'react';
import { EMOTIONS } from '../../../contracts';
import type { Emotion } from '../../../contracts';
import type { Services } from '../../../app/services';

/** Only shown while some module is a mock. Lets you play every role without any hardware. */
export function DevPanel({ mocks }: { mocks: Services['mocks'] }) {
  const [text, setText] = useState('');
  if (!mocks.stt && !mocks.emotion && !mocks.eye) return null;

  return (
    <details className="devpanel" open>
      <summary>Dev panel (mock modules)</summary>

      {mocks.stt && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mocks.stt?.simulate(text);
            setText('');
          }}
        >
          <label>
            Pretend the partner says:{' '}
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Are you hungry?"
            />
          </label>
          <button type="submit">Send</button>
        </form>
      )}

      {mocks.emotion && (
        <label>
          Pretend the user's face shows:{' '}
          <select
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value as Emotion | '';
              mocks.emotion?.setEmotion(v || 'neutral', v ? 0.9 : 0);
            }}
          >
            <option value="">(nothing detected)</option>
            {EMOTIONS.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </label>
      )}

      {mocks.eye && (
        <p className="keys">
          Keyboard = eyes: <kbd>↑</kbd>/<kbd>↓</kbd> look · <kbd>Space</kbd> select · <kbd>1</kbd>–
          <kbd>4</kbd> select directly · <kbd>Enter</kbd> confirm ("yes") · <kbd>Esc</kbd> cancel
          ("no"). Clicking also works.
        </p>
      )}
    </details>
  );
}
