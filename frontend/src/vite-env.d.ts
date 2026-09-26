/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOCK_EYE?: string;
  readonly VITE_MOCK_EMOTION?: string;
  readonly VITE_MOCK_STT?: string;
  readonly VITE_MOCK_CONVERSATION?: string;
  readonly VITE_TTS_PROVIDER?: string;
}
