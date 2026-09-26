import { api } from '../../../core/api';
import type { SuggestionFetcher } from '../conversationService';

/** Asks the backend (which asks Claude) for suggestions. */
export const apiSuggestions: SuggestionFetcher = async (history, mood) => {
  const { suggestions } = await api.suggestions(history, mood);
  return suggestions;
};
