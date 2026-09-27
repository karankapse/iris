import type {
  ConversationService,
  ConversationTurn,
  Emotion,
  FaceReaction,
  ReplyBundle,
  Suggestion,
  UserProfile,
} from '../../contracts';

/** The most AI suggestions we keep for one partner utterance. */
export const MAX_SUGGESTIONS = 4;

export type SuggestionFetcher = (
  history: ConversationTurn[],
  mood: Emotion | null,
  profile?: UserProfile,
  reaction?: Emotion | null,
) => Promise<Suggestion[]>;

/** Like SuggestionFetcher, but also says how the moment feels (words + face). */
export type ReplyBundleFetcher = (
  history: ConversationTurn[],
  mood: Emotion | null,
  profile?: UserProfile,
  reaction?: Emotion | null,
  face?: FaceReaction,
) => Promise<ReplyBundle>;

/**
 * Keeps the conversation history and asks a `fetcher` for suggestions.
 * The mock and real versions differ only in the fetcher (canned list vs. backend call).
 */
export class HistoryConversationService implements ConversationService {
  private turns: ConversationTurn[] = [];

  constructor(
    private fetchSuggestions: (
      ...args: Parameters<ReplyBundleFetcher>
    ) => Promise<Suggestion[] | ReplyBundle>,
  ) {}

  addTurn(turn: ConversationTurn) {
    this.turns.push(turn);
  }

  history() {
    return [...this.turns];
  }

  clear() {
    this.turns = [];
  }

  async suggestReplies(mood: Emotion | null, profile?: UserProfile, reaction?: Emotion | null) {
    return (await this.suggestRepliesWithEmotion(mood, profile, reaction)).suggestions;
  }

  async suggestRepliesWithEmotion(
    mood: Emotion | null,
    profile?: UserProfile,
    reaction?: Emotion | null,
    face?: FaceReaction,
  ): Promise<ReplyBundle> {
    const out = await this.fetchSuggestions(this.history(), mood, profile, reaction, face);
    const bundle = Array.isArray(out) ? { suggestions: out, emotion: null } : out;
    // Claude gives 3-4. Two are shown straight away; the rest are under "Other…" → "More replies".
    return { ...bundle, suggestions: bundle.suggestions.slice(0, MAX_SUGGESTIONS) };
  }
}
