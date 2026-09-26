import type {
  ConversationService,
  EmotionDetector,
  EyeInput,
  FaceTracker,
  SpeechToText,
  TtsProvider,
} from '../contracts';
import { flags } from '../core/config';
import { MediaPipeFaceTracker } from '../core/face/MediaPipeFaceTracker';
import { MockFaceTracker } from '../core/face/MockFaceTracker';
import {
  apiSuggestions,
  cannedSuggestions,
  HistoryConversationService,
  MockSpeechToText,
  MuseSpeechToText,
  WebSpeechToText,
} from '../modules/conversation';
import { MockEmotionDetector, RealEmotionDetector } from '../modules/emotion';
import { MockEyeInput, RealEyeInput } from '../modules/eye-input';
import { createTts } from '../modules/voice-ui/tts';

function createStt(provider: typeof flags.stt): SpeechToText {
  if (provider === 'muse') return new MuseSpeechToText();
  if (provider === 'webspeech') return new WebSpeechToText();
  return new MockSpeechToText();
}

export interface Services {
  faceTracker: FaceTracker;
  eyeInput: EyeInput;
  emotion: EmotionDetector;
  stt: SpeechToText;
  conversation: ConversationService;
  tts: TtsProvider;
  /** Set only when the matching module is a mock, so the Dev Panel can drive it. */
  /** True when a real module reads the camera (so the preview/calibration UI makes sense). */
  usesCamera: boolean;
  mocks: { emotion: MockEmotionDetector | null; eye: boolean };
}

/**
 * THE one place that decides mock vs. real for each module (see core/config.ts for the flags).
 * Constructors here must not start anything (no camera, no mic): `Orchestrator.start()` does that.
 */
export function createServices(): Services {
  // Both Eye Input and Emotion read the same FaceTracker, so the webcam is only opened once.
  const needsCamera = !flags.mockEye || !flags.mockEmotion;
  const faceTracker = needsCamera ? new MediaPipeFaceTracker() : new MockFaceTracker();

  const mockEmotion = flags.mockEmotion ? new MockEmotionDetector() : null;

  return {
    faceTracker,
    eyeInput: flags.mockEye ? new MockEyeInput() : new RealEyeInput(faceTracker),
    emotion: mockEmotion ?? new RealEmotionDetector(),
    stt: createStt(flags.stt),
    conversation: new HistoryConversationService(
      flags.mockConversation ? cannedSuggestions : apiSuggestions,
    ),
    tts: createTts(flags.tts),
    usesCamera: needsCamera,
    mocks: { emotion: mockEmotion, eye: flags.mockEye },
  };
}

let instance: Services | null = null;
/** Lazily create the services once per page. */
export function getServices(): Services {
  return (instance ??= createServices());
}
