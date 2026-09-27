// While a menu or panel is open over the options, the eyes can't highlight or choose behind it.
import { describe, expect, it } from 'vitest';
import type { EyeEvent } from '../contracts';
import { createEmitter } from '../core/emitter';
import { Orchestrator } from './Orchestrator';
import type { Services } from './services';

function setup() {
  localStorage.clear();
  const eyes = createEmitter<EyeEvent>();
  const noop = () => undefined;
  const services = {
    faceTracker: { start: async () => undefined, stop: noop, onFrame: () => noop, video: null },
    gaze: null,
    eyeInput: { start: noop, stop: noop, setOptionCount: noop, on: eyes.on },
    gazeLearning: null,
    emotion: {
      onFrame: noop,
      current: () => ({ emotion: 'neutral', confidence: 0 }),
      currentFeatures: () => null,
    },
    stt: { start: noop, stop: noop, onTranscript: () => noop },
    conversation: { addTurn: noop, history: () => [], suggestReplies: async () => [] },
    tts: { speak: async () => undefined, cancel: noop },
    usesCamera: false,
    usesMic: false,
    mocks: { emotion: null, eye: true },
  } as unknown as Services;
  const o = new Orchestrator(services, 'test');
  o.start();
  return { o, eyes };
}

describe('Orchestrator: eyes paused while a menu is open', () => {
  it('ignores highlights and selections until every open panel is closed', () => {
    const { o, eyes } = setup();
    eyes.emit({ type: 'highlight', optionIndex: 1, dwellProgress: 0.5 });
    expect(o.getView().highlight).toBe(1);

    o.setSuspended(true, 'menu');
    expect(o.getView().highlight).toBeNull(); // no half-filled dwell left behind
    o.setSuspended(true, 'tuning');
    eyes.emit({ type: 'highlight', optionIndex: 2, dwellProgress: 0.9 });
    eyes.emit({ type: 'select', optionIndex: 0 }); // would open "Quick phrases"
    expect(o.getView().highlight).toBeNull();
    expect(o.getView().machine.phase).toBe('listening');

    o.setSuspended(false, 'menu'); // tuning panel still open
    eyes.emit({ type: 'select', optionIndex: 0 });
    expect(o.getView().machine.phase).toBe('listening');

    o.setSuspended(false, 'tuning');
    eyes.emit({ type: 'select', optionIndex: 0 });
    expect(o.getView().machine.phase).not.toBe('listening');
  });
});
