// Typed client for the FastAPI backend. Types come from the backend's Pydantic models via
// `src/shared/api.generated.ts` (regenerate with `make gen-types`). Do not hand-write payload types.
import type { Emotion } from '../contracts';
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

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
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
  suggestions: (history: ApiTurn[], mood: Emotion | null) =>
    request<Schemas['SuggestionsResponse']>('POST', '/api/suggestions', { history, mood }),

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
