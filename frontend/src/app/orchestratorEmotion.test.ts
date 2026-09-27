// The Orchestrator sends the whole face reading with the suggestion request, shows how the
// moment feels, and teaches the emotion model from ~10 frames of the reaction window.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Emotion, EmotionDetector, FaceReaction, ToneFeedback } from '../contracts';
import { MockFaceTracker } from '../core/face/MockFaceTracker';
import { HistoryConversationService, MockSpeechToText } from '../modules/conversation';
import { MockEyeInput } from '../modules/eye-input';
import { getEntries } from './machine';
import { Orchestrator } from './Orchestrator';
import type { Services } from './services';

function setup(feelEmotion: Emotion = 'excited') {
  localStorage.clear();
  const feedback: ToneFeedback[] = [];
  let frame = 0;
  const emotion: EmotionDetector = {
    onFrame: () => undefined,
    current: () => ({ emotion: 'happy', confidence: 0.8 }),
    currentFeatures: () => [frame, 0],
    // every third frame is a blink: not usable
    currentUsableFeatures: () => (++frame % 3 === 0 ? null : [frame, 0]),
    recordSample: async () => undefined,
    train: async () => undefined,
    addFeedback: async (fb) => void feedback.push(fb),
  };
  const faces: (FaceReaction | undefined)[] = [];
  const conversation = new HistoryConversationService(async (_h, _m, _p, _r, face) => {
    faces.push(face);
    return {
      suggestions: [{ id: '1', text: 'Thank you!', tone: 'neutral' }],
      emotion: {
        emotion: feelEmotion,
        confidence: 0.9,
        reason: 'good news, smiling',
        source: 'face + words',
      },
    };
  });
  const services = {
    faceTracker: new MockFaceTracker(),
    gaze: null,
    eyeInput: new MockEyeInput(),
    gazeLearning: null,
    emotion,
    stt: new MockSpeechToText(),
    conversation,
    tts: { speak: async () => undefined, cancel: () => undefined },
    usesCamera: false,
    usesMic: false,
    mocks: { emotion: null, eye: true },
  } as unknown as Services;
  const o = new Orchestrator(services, 'test');
  const choose = (label: string) => {
    const i = getEntries(o.getView().machine).findIndex((e) => e.option.label.startsWith(label));
    expect(i).toBeGreaterThanOrEqual(0);
    o.dispatch({ type: 'eye', event: { type: 'select', optionIndex: i } });
  };
  return { o, faces, feedback, choose };
}

describe('Orchestrator: emotion from words + face', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends the face reading and stores how the moment feels', async () => {
    const h = setup();
    h.o.dispatch({ type: 'partner_final', text: 'You got the job!', at: 0 });
    await vi.advanceTimersByTimeAsync(2500);
    expect(h.faces[0]).toMatchObject({ peak: 'happy', confidence: 0.8 });
    expect(h.faces[0]?.scores.happy).toBeGreaterThan(0.5);
    const m = h.o.getView().machine;
    expect(m.phase).toBe('selectReply');
    expect(m.feel?.emotion).toBe('excited');
    expect(m.measuredEmotion).toBe('excited'); // the default tone
  });

  it('a confirmed tone teaches the model with ~10 good frames from the reaction window', async () => {
    const h = setup('happy'); // the face showed happy and the reply was spoken happy
    h.o.dispatch({ type: 'partner_final', text: 'You got the job!', at: 0 });
    await vi.advanceTimersByTimeAsync(2500);
    h.choose('Thank you!');
    await vi.advanceTimersByTimeAsync(10);
    expect(h.o.getView().machine.phase).toBe('feedback');
    h.choose('Yes');
    await vi.advanceTimersByTimeAsync(10);
    const fb = h.feedback.find((f) => f.userToneOk === true);
    expect(fb?.spokenTone).toBe('happy');
    // 13 readings in the 1.2 s window, minus blinks, at most 10 kept
    expect(fb?.featureFrames?.length).toBeGreaterThanOrEqual(8);
    expect(fb?.featureFrames?.length).toBeLessThanOrEqual(10);
    // blink frames (every third) were never kept
    expect(fb?.featureFrames?.every(([n]) => n % 3 !== 0)).toBe(true);
  });

  it('a right tone the face did not show teaches nothing (no feedback loop)', async () => {
    const h = setup('excited'); // spoken excited, but the face looked happy
    h.o.dispatch({ type: 'partner_final', text: 'You got the job!', at: 0 });
    await vi.advanceTimersByTimeAsync(2500);
    h.choose('Thank you!');
    await vi.advanceTimersByTimeAsync(10);
    h.choose('Yes');
    await vi.advanceTimersByTimeAsync(10);
    const fb = h.feedback.find((f) => f.userToneOk === true);
    expect(fb?.spokenTone).toBe('excited');
    expect(fb?.featureFrames).toEqual([]);
    expect(fb?.features).toBeNull();
  });
});
