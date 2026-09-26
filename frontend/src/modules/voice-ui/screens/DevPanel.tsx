import { useState } from 'react';
import { EMOTIONS } from '../../../contracts';
import type { Emotion } from '../../../contracts';
import type { Services } from '../../../app/services';

interface Props {
  mocks: Services['mocks'];
  /** Feed text in as if the partner had just said it. */
  onPartnerText: (text: string) => void;
}

/**
 * Always available: a text box to enter what the partner says (a caregiver fallback when the
 * microphone is off or unreliable). Extra controls appear for whichever modules are mocked.
 */
export function DevPanel({ mocks, onPartnerText }: Props) {
  const [text, setText] = useState('');

  return (
    <details className="devpanel" open>
      <summary>Dev panel</summary>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onPartnerText(text);
          setText('');
        }}
      >
        <label>
          Type what the partner says:{' '}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Are you hungry?"
          />
        </label>
        <button type="submit">Send</button>
      </form>

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
