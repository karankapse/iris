// "Stop speaking" must never leave the app stuck on the speaking screen, even if the voice
// engine never reports back.
import { describe, expect, it } from 'vitest';
import type { TtsProvider } from '../contracts';
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
import type { Services } from './services';

/** A broken voice: speak() never finishes, and cancel() doesn't help. */
const hangingTts: TtsProvider = { speak: () => new Promise(() => {}), cancel: () => {} };

describe('Orchestrator: Stop speaking', () => {
  it('gets back to listening even if the voice never reports back', async () => {
    localStorage.clear();
    const services = {
      faceTracker: new MockFaceTracker(),
      gaze: null,
      eyeInput: new MockEyeInput(),
      gazeLearning: null,
      emotion: new MockEmotionDetector(),
      stt: new MockSpeechToText(),
      conversation: new HistoryConversationService(cannedSuggestions),
      tts: hangingTts,
      usesCamera: false,
      usesMic: false,
      mocks: { emotion: null, eye: true },
    } as unknown as Services;
    const o = new Orchestrator(services, 'test');
    const pick = (i: number) =>
      o.dispatch({ type: 'eye', event: { type: 'select', optionIndex: i } });

    o.dispatch({ type: 'partner_final', text: 'How are you today?' });
    await expect.poll(() => o.getView().machine.phase, { timeout: 3000 }).toBe('selectReply');
    pick(0);
    expect(o.getView().machine.phase).toBe('speaking');

    const stop = getEntries(o.getView().machine).findIndex(
      (e) => e.option.label === 'Stop speaking',
    );
    pick(stop);
    await expect.poll(() => o.getView().machine.phase, { timeout: 3000 }).not.toBe('speaking');

    // and the partner is heard again
    o.dispatch({ type: 'partner_final', text: 'Are you still there?' });
    expect(['suggesting', 'selectReply']).toContain(o.getView().machine.phase);
  });
});
