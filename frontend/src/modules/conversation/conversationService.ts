import type {
  ConversationService,
  ConversationTurn,
  Emotion,
  Suggestion,
  UserProfile,
} from '../../contracts';

/** The most AI suggestions we keep for one partner utterance. */
export const MAX_SUGGESTIONS = 4;

export type SuggestionFetcher = (
  history: ConversationTurn[],
  mood: Emotion | null,
  profile?: UserProfile,
) => Promise<Suggestion[]>;

/**
 * Keeps the conversation history and asks a `fetcher` for suggestions.
 * The mock and real versions differ only in the fetcher (canned list vs. backend call).
 */
export class HistoryConversationService implements ConversationService {
  private turns: ConversationTurn[] = [];

  constructor(private fetchSuggestions: SuggestionFetcher) {}

  addTurn(turn: ConversationTurn) {
    this.turns.push(turn);
  }

  history() {
    return [...this.turns];
  }

  async suggestReplies(mood: Emotion | null, profile?: UserProfile) {
    const suggestions = await this.fetchSuggestions(this.history(), mood, profile);
    // Claude gives 3-4. Two are shown straight away; the rest are under "Other…" → "More replies".
    return suggestions.slice(0, MAX_SUGGESTIONS);
  }
}
