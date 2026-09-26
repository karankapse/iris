import type { ConversationService, ConversationTurn, Emotion, Suggestion } from '../../contracts';
import { MAX_OPTIONS } from '../../core/config';

export type SuggestionFetcher = (
  history: ConversationTurn[],
  mood: Emotion | null,
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

  async suggestReplies(mood: Emotion | null) {
    const suggestions = await this.fetchSuggestions(this.history(), mood);
    return suggestions.slice(0, MAX_OPTIONS);
  }
}
