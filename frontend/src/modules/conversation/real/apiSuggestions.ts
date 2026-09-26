import { api } from '../../../core/api';
import type { SuggestionFetcher } from '../conversationService';

/** Asks the backend (which asks Claude) for suggestions. */
export const apiSuggestions: SuggestionFetcher = async (history, mood, profile, reaction) => {
  const { suggestions } = await api.suggestions(history, mood, profile, reaction);
  return suggestions;
};
