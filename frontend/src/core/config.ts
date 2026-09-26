/** Single local user for now. Later this could come from a profile picker. */
export const USER_ID = 'local-user';

/** Every screen shows exactly this many options (the last is always "Other…"). */
export const MAX_OPTIONS = 3;

/**
 * Each module can run as a mock (fake, works with no camera/mic/API key) or for real.
 * Mocks are ON by default. To use the real one, set e.g. `VITE_MOCK_EYE=0` in `.env`.
 */
const isMock = (value: string | undefined) => value !== '0';

export const flags = {
  mockEye: isMock(import.meta.env.VITE_MOCK_EYE),
  mockEmotion: isMock(import.meta.env.VITE_MOCK_EMOTION),
  /**
   * Where the partner's speech comes from:
   *   'mock'      no microphone; type what the partner says in the Dev Panel (default)
   *   'auto'      Meta Muse if the backend has MODEL_API_KEY, else Chrome's recognition
   *   'muse'      Meta Muse Voice Transcribe via the backend only (needs MODEL_API_KEY)
   *   'webspeech' the browser's built-in recognition (Chrome; sends audio to Google)
   */
  stt:
    (import.meta.env.VITE_STT_PROVIDER as 'mock' | 'auto' | 'muse' | 'webspeech' | undefined) ??
    'mock',
  /**
   * How "where on the screen am I looking" is measured (real eye input only):
   *   'webgazer'  WebGazer learns your gaze from calibration dots (default)
   *   'mediapipe' the older approach: a classifier over MediaPipe face signals
   *   'mouse'     the mouse pointer stands in for the gaze (development, no camera needed)
   */
  gazeEngine:
    (import.meta.env.VITE_GAZE_ENGINE as 'webgazer' | 'mediapipe' | 'mouse' | undefined) ??
    'webgazer',
  mockConversation: isMock(import.meta.env.VITE_MOCK_CONVERSATION),
  /** 'cloned' = ElevenLabs with BrowserTts fallback (default), 'browser' = speechSynthesis only, 'silent' = no sound. */
  tts:
    (import.meta.env.VITE_TTS_PROVIDER as 'browser' | 'silent' | 'cloned' | undefined) ?? 'cloned',
};
