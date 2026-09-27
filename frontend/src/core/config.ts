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
   * How "where on the screen am I looking" is measured, for "Look at an option" mode.
   * (The default glance mode reads eye movement directly and needs none of these.)
   *   'mediapipe' a per-person classifier over MediaPipe's iris/eye signals (default)
   *   'webgazer'  WebGazer learns your gaze from calibration dots (a second camera stream)
   *   'mouse'     the mouse pointer stands in for the gaze (development, no camera needed)
   */
  gazeEngine:
    (import.meta.env.VITE_GAZE_ENGINE as 'webgazer' | 'mediapipe' | 'mouse' | undefined) ??
    'mediapipe',
  mockConversation: isMock(import.meta.env.VITE_MOCK_CONVERSATION),
  /** 'cloned' = ElevenLabs with BrowserTts fallback (default), 'browser' = speechSynthesis only, 'silent' = no sound. */
  tts:
    (import.meta.env.VITE_TTS_PROVIDER as 'browser' | 'silent' | 'cloned' | undefined) ?? 'cloned',
};

/**
 * Where the backend runs when it is NOT on the same site as the page (production: the page is on
 * Vercel, the backend on Railway). Plain HTTP calls still use `/api/...` (Vercel forwards them);
 * live WebSocket streams can't be forwarded, so they connect to the backend directly.
 */
const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, '');

/** The WebSocket address for a backend path such as `/api/stt/stream`. */
export function wsUrl(path: string): string {
  if (BACKEND_URL) return BACKEND_URL.replace(/^http/, 'ws') + path;
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}${path}`;
}
