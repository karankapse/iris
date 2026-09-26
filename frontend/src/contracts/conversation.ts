// ============================================================================
// Conversation AI contracts  (Module 3)
// ============================================================================
import type { Emotion } from './emotion';

export type Speaker = 'partner' | 'user';

export interface ConversationTurn {
  speaker: Speaker;
  text: string;
}

export interface Suggestion {
  id: string;
  text: string;
  /** The tone Claude thinks fits this reply. */
  tone: Emotion;
}

export interface Transcript {
  text: string;
  /** false = still being recognised (partial), true = the partner finished a sentence. */
  isFinal: boolean;
}

/** What the speech-to-text engine is doing right now, for the on-screen mic indicator. */
export interface SttStatus {
  state: 'off' | 'connecting' | 'listening' | 'error';
  /** Human-readable engine name, e.g. "Meta Muse" or "Chrome speech". */
  engine: string;
  /** Extra explanation (why it fell back, what went wrong). */
  detail?: string;
}

/**
 * Speech-to-text. Start with the browser's Web Speech API; keep everything behind this
 * interface so we can swap in Whisper later without touching other modules.
 */
export interface SpeechToText {
  start(): void;
  stop(): void;
  /** Subscribe to transcripts. Returns an unsubscribe function. */
  onTranscript(handler: (transcript: Transcript) => void): () => void;
  /** Optional: problems that happen after start() (lost connection, no permission...). */
  onError?(handler: (message: string) => void): () => void;
  /** Optional: connection state for the on-screen mic indicator. */
  onStatus?(handler: (status: SttStatus) => void): () => void;
}

/** Who the user is, so suggestions feel personal. Matches the backend's UserProfile. */
export interface UserProfile {
  name: string;
  relationships: string[];
  interests: string[];
  common_needs: string[];
  /** Quick-access phrases. */
  phrases: string[];
}

export interface ConversationService {
  addTurn(turn: ConversationTurn): void;
  history(): ConversationTurn[];
  /** Ask the AI for 3-4 suggested replies (never more than 4). */
  suggestReplies(mood: Emotion | null, profile?: UserProfile): Promise<Suggestion[]>;
}
