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
}

export interface ConversationService {
  addTurn(turn: ConversationTurn): void;
  history(): ConversationTurn[];
  /** Ask the AI for 3-4 suggested replies (never more than 4). */
  suggestReplies(mood: Emotion | null): Promise<Suggestion[]>;
}
