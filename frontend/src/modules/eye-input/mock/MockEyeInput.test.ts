import { afterEach, describe, expect, it } from 'vitest';
import type { EyeEvent } from '../../../contracts';
import { MockEyeInput } from './MockEyeInput';

const eyes = new MockEyeInput();
afterEach(() => {
  eyes.stop();
  document.body.replaceChildren();
});

function start() {
  const events: EyeEvent[] = [];
  eyes.start({ mode: 'full', optionCount: 3 });
  eyes.on((event) => events.push(event));
  return events;
}

describe('keyboard eye controls around caregiver UI', () => {
  it('keeps direct selection, navigation, confirmation and cancel on the main surface', () => {
    const events = start();
    for (const key of ['ArrowRight', ' ', '3', 'Enter', 'Escape']) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    expect(events).toEqual([
      { type: 'highlight', optionIndex: 1, dwellProgress: 0 },
      { type: 'select', optionIndex: 1 },
      { type: 'select', optionIndex: 2 },
      { type: 'confirm' },
      { type: 'cancel' },
    ]);
  });

  it('leaves native button activation and dialog keys to the browser', () => {
    const events = start();
    const button = document.createElement('button');
    document.body.append(button);
    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      button.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    const dialog = document.createElement('dialog');
    dialog.append(button);
    document.body.append(dialog);
    for (const key of ['Escape', '1', 'ArrowDown']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      button.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(events).toEqual([]);
  });
});
