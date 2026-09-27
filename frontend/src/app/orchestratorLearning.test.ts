// The app tells the eye input's online learning when a selection was acted on, confirmed or
// stopped (see eye-input/real/onlineLearning.ts).
import { describe, expect, it, vi } from 'vitest';
import type { Emotion, SpeakOptions, TtsProvider } from '../contracts';
import { MockFaceTracker } from '../core/face/MockFaceTracker';
import {
  cannedSuggestions,
  HistoryConversationService,
  MockSpeechToText,
} from '../modules/conversation';
import { MockEmotionDetector } from '../modules/emotion';
import { MockEyeInput } from '../modules/eye-input';
import { getEntries } from './machine';
import { Orchestrator } from './Orchestrator';
import type { GazeLearning, Services } from './services';

/** A voice that only finishes when told to. */
class ManualTts implements TtsProvider {
  private finish: (() => void) | null = null;
  async speak(_text: string, _emotion: Emotion, _options?: SpeakOptions) {
    await new Promise<void>((r) => (this.finish = r));
  }
  cancel() {
    this.done();
  }
  done() {
    this.finish?.();
    this.finish = null;
  }
}

function setup() {
  localStorage.clear();
  const learning: GazeLearning = { hold: vi.fn(), confirm: vi.fn(() => 1), discard: vi.fn() };
  const tts = new ManualTts();
  const services = {
    faceTracker: new MockFaceTracker(),
    gaze: null,
    eyeInput: new MockEyeInput(),
    gazeLearning: learning,
    emotion: new MockEmotionDetector(),
    stt: new MockSpeechToText(),
    conversation: new HistoryConversationService(cannedSuggestions),
    tts,
    usesCamera: false,
    usesMic: false,
    mocks: { emotion: null, eye: true },
  } as unknown as Services;
  const o = new Orchestrator(services, 'test');
  /** Select the option whose label starts with `label`, as the eyes would. */
  const choose = (label: string) => {
    const i = getEntries(o.getView().machine).findIndex((e) => e.option.label.startsWith(label));
    expect(i).toBeGreaterThanOrEqual(0);
    o.dispatch({ type: 'eye', event: { type: 'select', optionIndex: i } });
  };
  return { o, learning, tts, choose };
}

/** Quick phrases -> first phrase -> "Speak it": the reply starts playing. */
function speakAPhrase(h: ReturnType<typeof setup>) {
  h.choose('Quick phrases');
  const phrase = getEntries(h.o.getView().machine)[0].option.label;
  h.choose(phrase);
  h.choose('Speak it');
}

describe('gaze learning in the app', () => {
  it('a reply chosen with the eyes and spoken to the end confirms the selection', async () => {
    const h = setup();
    speakAPhrase(h);
    expect(h.learning.hold).toHaveBeenCalledTimes(1);
    h.tts.done();
    await vi.waitFor(() => expect(h.learning.confirm).toHaveBeenCalledTimes(1));
    expect(h.learning.discard).not.toHaveBeenCalled();
  });

  it('stopping the reply discards it', async () => {
    const h = setup();
    speakAPhrase(h);
    h.o.dispatch({ type: 'eye', event: { type: 'cancel' } }); // "back" while speaking = stop
    await vi.waitFor(() => expect(h.learning.discard).toHaveBeenCalled());
    await Promise.resolve();
    expect(h.learning.confirm).not.toHaveBeenCalled();
  });

  it('a reply not chosen with the eyes (typed by a caregiver) teaches nothing', async () => {
    const h = setup();
    h.choose('Type my own reply');
    h.o.dispatch({ type: 'custom_reply', text: 'Hello there' });
    const before = (h.learning.hold as ReturnType<typeof vi.fn>).mock.calls.length;
    // "Speak it" is chosen by keyboard/mouse here, i.e. not an eye selection
    h.o.dispatch({ type: 'eye', event: { type: 'confirm' } });
    expect((h.learning.hold as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
  });
});
