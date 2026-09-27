import { api } from '../../../core/api';
import type { ReplyBundleFetcher } from '../conversationService';

/** Asks the backend (which asks Claude) for suggestions, and how the moment feels. */
export const apiSuggestions: ReplyBundleFetcher = async (
  history,
  mood,
  profile,
  reaction,
  face,
) => {
  const res = await api.suggestions(history, mood, profile, reaction, face);
  return { suggestions: res.suggestions, emotion: res.conversation_emotion ?? null };
};
