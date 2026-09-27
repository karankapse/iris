// Typed client for the FastAPI backend. Types come from the backend's Pydantic models via
// `src/shared/api.generated.ts` (regenerate with `make gen-types`). Do not hand-write payload types.
import type { Emotion, FaceReaction, UserProfile } from '../contracts';
import type { components } from '../shared/api.generated';

type Schemas = components['schemas'];
export type ApiSuggestion = Schemas['Suggestion'];
export type ApiEmotionModel = Schemas['EmotionModel'];
export type ApiTurn = Schemas['ConversationTurn'];

// Compile-time check that the hand-written `Emotion` (contracts) and the backend's Emotion
// are the same list. If someone edits only one side, `npm run typecheck` fails.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const _emotionListsMatch: Same<Emotion, Schemas['Suggestion']['tone']> = true;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new ApiError(res.status, detail?.detail ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  suggestions: (
    history: ApiTurn[],
    mood: Emotion | null,
    profile?: UserProfile,
    reaction?: Emotion | null,
    face?: FaceReaction,
  ) =>
    request<Schemas['SuggestionsResponse']>('POST', '/api/suggestions', {
      history,
      mood,
      profile: profile ?? null,
      reaction: reaction ?? null,
      face_reaction: face ?? null,
    }),

  /** Is speech heard while replies load part of the same turn (vs. the TV)? Fast model. */
  related: (previous: string, next: string) =>
    request<Schemas['RelatedResponse']>('POST', '/api/related', { previous, new: next }),

  getProfile: (userId: string) => request<UserProfile>('GET', `/api/profile/${userId}`),

  putProfile: (userId: string, profile: UserProfile) =>
    request<UserProfile>('PUT', `/api/profile/${userId}`, profile),

  /** First-letter typing: guess full replies from the first letter of each word. */
  expand: (initials: string, history: ApiTurn[], mood: Emotion | null, profile?: UserProfile) =>
    request<Schemas['SuggestionsResponse']>('POST', '/api/expand', {
      initials,
      history,
      mood,
      profile: profile ?? null,
    }),

  /** Remember one moment of conversation (what was said, how the user felt, what they replied). */
  logExchange: (body: Schemas['ExchangeLog']) =>
    request<{ stored: boolean }>('POST', '/api/conversation/log', body),

  getMemory: (userId: string, limit = 20) =>
    request<Schemas['MemoryResponse']>('GET', `/api/conversation/memory/${userId}?limit=${limit}`),

  forgetMemory: (userId: string) =>
    request<{ deleted: number }>('DELETE', `/api/conversation/memory/${userId}`),

  addSamples: (body: Schemas['SamplesRequest']) =>
    request<{ stored: number }>('POST', '/api/emotion/samples', body),

  train: (userId: string) =>
    request<ApiEmotionModel>('POST', '/api/emotion/train', { user_id: userId }),

  /** Returns null when the user has no trained model yet (404). */
  async getModel(userId: string): Promise<ApiEmotionModel | null> {
    try {
      return await request<ApiEmotionModel>('GET', `/api/emotion/model/${userId}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },

  feedback: (body: Schemas['FeedbackRequest']) =>
    request<{ stored: boolean; added_training_sample: boolean }>('POST', '/api/feedback', body),
};
