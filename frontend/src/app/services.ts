import type {
  ConversationService,
  ScreenGaze,
  EmotionDetector,
  EyeInput,
  FaceTracker,
  SpeechToText,
  TtsProvider,
} from '../contracts';
import { flags } from '../core/config';
import { MouseGaze } from '../core/gaze/MouseGaze';
import { WebGazerGaze } from '../core/gaze/WebGazerGaze';
import { MediaPipeFaceTracker } from '../core/face/MediaPipeFaceTracker';
import { MockFaceTracker } from '../core/face/MockFaceTracker';
import {
  apiSuggestions,
  cannedSuggestions,
  HistoryConversationService,
  AutoSpeechToText,
  MockSpeechToText,
  MuseSpeechToText,
  WebSpeechToText,
} from '../modules/conversation';
import { MockEmotionDetector, RealEmotionDetector } from '../modules/emotion';
import { MockEyeInput, RealEyeInput } from '../modules/eye-input';
import { createTts } from '../modules/voice-ui/tts';

function createStt(provider: typeof flags.stt): SpeechToText {
  if (provider === 'auto') return new AutoSpeechToText();
  if (provider === 'muse') return new MuseSpeechToText();
  if (provider === 'webspeech') return new WebSpeechToText();
  return new MockSpeechToText();
}

export interface Services {
  faceTracker: FaceTracker;
  /** Where on the screen the person looks (WebGazer or mouse). null = not used. */
  gaze: ScreenGaze | null;
  eyeInput: EyeInput;
  emotion: EmotionDetector;
  stt: SpeechToText;
  conversation: ConversationService;
  tts: TtsProvider;
  /** Set only when the matching module is a mock, so the Dev Panel can drive it. */
  /** True when a real module reads the camera (so the preview/calibration UI makes sense). */
  usesCamera: boolean;
  /** True when a real microphone engine is in use (so the mic indicator makes sense). */
  usesMic: boolean;
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

  const gaze: ScreenGaze | null = flags.mockEye
    ? null
    : flags.gazeEngine === 'webgazer'
      ? new WebGazerGaze()
      : flags.gazeEngine === 'mouse'
        ? new MouseGaze()
        : null;

  return {
    faceTracker,
    gaze,
    eyeInput: flags.mockEye ? new MockEyeInput() : new RealEyeInput(faceTracker, gaze),
    emotion: mockEmotion ?? new RealEmotionDetector(),
    stt: createStt(flags.stt),
    conversation: new HistoryConversationService(
      flags.mockConversation ? cannedSuggestions : apiSuggestions,
    ),
    tts: createTts(flags.tts),
    usesCamera: needsCamera,
    usesMic: flags.stt !== 'mock',
    mocks: { emotion: mockEmotion, eye: flags.mockEye },
  };
}

let instance: Services | null = null;
/** Lazily create the services once per page. */
export function getServices(): Services {
  return (instance ??= createServices());
}
