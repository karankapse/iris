// The Mute button really turns the microphone off, and nothing heard counts while muted.
import { describe, expect, it } from 'vitest';
import type { Transcript } from '../contracts';
import { createEmitter } from '../core/emitter';
import { Orchestrator } from './Orchestrator';
import type { Services } from './services';

function setup() {
  localStorage.clear();
  const heard = createEmitter<Transcript>();
  const mic = { starts: 0, stops: 0 };
  const noop = () => undefined;
  const services = {
    faceTracker: { start: async () => undefined, stop: noop, onFrame: () => noop, video: null },
    gaze: null,
    eyeInput: { start: noop, stop: noop, setOptionCount: noop, on: () => noop },
    gazeLearning: null,
    emotion: {
      onFrame: noop,
      current: () => ({ emotion: 'neutral', confidence: 0 }),
      currentFeatures: () => null,
    },
    stt: { start: () => mic.starts++, stop: () => mic.stops++, onTranscript: heard.on },
    conversation: { addTurn: noop, history: () => [], suggestReplies: async () => [] },
    tts: { speak: async () => undefined, cancel: noop },
    usesCamera: false,
    usesMic: true,
    mocks: { emotion: null, eye: true },
  } as unknown as Services;
  const o = new Orchestrator(services, 'test');
  o.start();
  return { o, heard, mic };
}

describe('Orchestrator: mute', () => {
  it('stops the mic, ignores what is heard, and starts it again on unmute', () => {
    const { o, heard, mic } = setup();
    heard.emit({ text: 'Are you', isFinal: false });
    expect(o.getView().machine.interim).toBe('Are you');

    o.setMicMuted(true);
    expect(o.getView().micMuted).toBe(true);
    expect(mic.stops).toBe(1);
    expect(o.getView().machine.interim).toBe(''); // no half sentence left on screen
    heard.emit({ text: 'Are you hungry?', isFinal: true });
    expect(o.getView().machine.phase).toBe('listening');

    const startsBefore = mic.starts;
    o.setMicMuted(false);
    expect(o.getView().micMuted).toBe(false);
    expect(mic.starts).toBe(startsBefore + 1);
  });
});
