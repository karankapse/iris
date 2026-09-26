// ============================================================================
// The conversation state machine. PURE: (state, event) -> (new state, side effects).
// No React, no camera, no network in here, which makes the rules easy to test.
//
//   listening -> suggesting -> selectReply -> confirmTone -> speaking -> feedback -> listening
//                                 |             |  ^
//                               typing       pickTone
//
// THE SAFETY RULE: the only way into `speaking` is a confirm/select on `confirmTone`.
// ============================================================================
import { EMOTIONS } from '../contracts';
import type { Emotion, EmotionEstimate, EyeEvent, Suggestion } from '../contracts';
import { MAX_OPTIONS } from '../core/config';

export type Phase =
  | 'listening' //   waiting for the partner to say something
  | 'suggesting' //  waiting for the AI's suggested replies
  | 'selectReply' // user picks one of the replies (or "type my own")
  | 'typing' //      fallback: custom reply
  | 'confirmTone' // "speak it in this tone?"  yes / change
  | 'pickTone' //    choose a different tone
  | 'speaking'
  | 'feedback'; //   "was the tone right?"

export interface Reply {
  text: string;
  /** The tone the AI suggested for this reply (used if there's no mood / detection). */
  suggestedTone: Emotion;
}

export interface SpokenReply {
  id: string;
  text: string;
  tone: Emotion;
}

export interface State {
  phase: Phase;
  partnerText: string;
  /** Partial (still-being-recognised) partner speech, shown live in the partner view. */
  interim: string;
  suggestions: Suggestion[];
  /** Increases per request so a slow, old response can't overwrite a newer one. */
  requestId: number;
  reply: Reply | null;
  /** The tone currently proposed in confirmTone. */
  tone: Emotion | null;
  /** Persistent mood setting: saves the user from choosing a tone every time. */
  mood: Emotion | null;
  detected: EmotionEstimate;
  lastSpoken: SpokenReply | null;
  utteranceCount: number;
  idPrefix: string;
  error: string | null;
}

export type Event =
  | { type: 'partner_partial'; text: string }
  | { type: 'partner_final'; text: string }
  | { type: 'suggestions_ready'; requestId: number; suggestions: Suggestion[] }
  | { type: 'suggestions_failed'; requestId: number; message: string }
  | { type: 'set_mood'; mood: Emotion | null }
  | { type: 'emotion_estimate'; estimate: EmotionEstimate }
  | { type: 'eye'; event: EyeEvent }
  | { type: 'custom_reply'; text: string }
  | { type: 'speak_done' }
  | { type: 'partner_reaction'; reaction: 'understood' | 'seemed_off' }
  | { type: 'error'; message: string }
  | { type: 'dismiss_error' };

/** Things the machine asks the outside world to do. The Orchestrator carries them out. */
export type Effect =
  | { type: 'suggest'; requestId: number; partnerText: string; mood: Emotion | null }
  | { type: 'snapshot_features' }
  | { type: 'speak'; spoken: SpokenReply }
  | { type: 'stop_speaking' }
  | { type: 'user_feedback'; spoken: SpokenReply; ok: boolean }
  | { type: 'partner_feedback'; spoken: SpokenReply; reaction: 'understood' | 'seemed_off' };

export interface Result {
  state: State;
  effects: Effect[];
}

export function initialState(mood: Emotion | null = null, idPrefix = 'utt'): State {
  return {
    phase: 'listening',
    partnerText: '',
    interim: '',
    suggestions: [],
    requestId: 0,
    reply: null,
    tone: null,
    mood,
    detected: { emotion: 'neutral', confidence: 0 },
    lastSpoken: null,
    utteranceCount: 0,
    idPrefix,
    error: null,
  };
}

/** Below this confidence we don't trust the detected emotion. */
export const MIN_DETECTION_CONFIDENCE = 0.5;

/**
 * Which tone to propose. Priority:
 *  1. the user's persistent mood (they chose it on purpose, and it saves effort)
 *  2. the emotion detected from their face, if we're confident
 *  3. the tone the AI suggested for this particular reply
 */
export function chooseTone(
  mood: Emotion | null,
  detected: EmotionEstimate,
  suggested: Emotion,
): Emotion {
  if (mood) return mood;
  if (detected.confidence >= MIN_DETECTION_CONFIDENCE) return detected.emotion;
  return suggested;
}

// ---- what is on screen as selectable options (max 4) ------------------------

export interface Option {
  label: string;
  hint?: string;
}

/** Only 3 AI suggestions are shown: the 4th slot is always "Type my own reply". */
export const visibleSuggestions = (s: State) => s.suggestions.slice(0, MAX_OPTIONS - 1);
export const otherTones = (s: State) => EMOTIONS.filter((e) => e !== s.tone);

export function getOptions(s: State): Option[] {
  switch (s.phase) {
    case 'selectReply':
      return [
        ...visibleSuggestions(s).map((x) => ({ label: x.text, hint: x.tone })),
        { label: 'Type my own reply' },
      ];
    case 'confirmTone':
      return [{ label: `Speak it (${s.tone})` }, { label: 'Change tone' }];
    case 'pickTone':
      return otherTones(s).map((t) => ({ label: t }));
    case 'feedback':
      return [{ label: 'Yes, that tone was right' }, { label: 'No, it was off' }];
    default:
      return [];
  }
}

// ---- the reducer ---------------------------------------------------------------

const same = (state: State): Result => ({ state, effects: [] });

export function reduce(state: State, event: Event): Result {
  switch (event.type) {
    case 'partner_partial':
      return same({ ...state, interim: event.text });

    case 'partner_final': {
      const text = event.text.trim();
      // While the app is speaking, ignore the room (it would also hear its own voice).
      if (!text || state.phase === 'speaking') return same(state);
      const requestId = state.requestId + 1;
      return {
        state: {
          ...state,
          phase: 'suggesting',
          partnerText: text,
          interim: '',
          suggestions: [],
          reply: null,
          tone: null,
          requestId,
          error: null,
        },
        effects: [{ type: 'suggest', requestId, partnerText: text, mood: state.mood }],
      };
    }

    case 'suggestions_ready':
      if (event.requestId !== state.requestId || state.phase !== 'suggesting') return same(state);
      if (event.suggestions.length === 0) {
        return same({ ...state, phase: 'listening', error: 'The AI returned no suggestions.' });
      }
      return same({ ...state, phase: 'selectReply', suggestions: event.suggestions });

    case 'suggestions_failed':
      if (event.requestId !== state.requestId || state.phase !== 'suggesting') return same(state);
      return same({ ...state, phase: 'listening', error: event.message });

    case 'set_mood':
      return same({ ...state, mood: event.mood });

    case 'emotion_estimate':
      return same({ ...state, detected: event.estimate });

    case 'error':
      return same({ ...state, error: event.message });

    case 'dismiss_error':
      return same({ ...state, error: null });

    case 'custom_reply': {
      const text = event.text.trim();
      if (state.phase !== 'typing' || !text) return same(state);
      return proposeTone(state, { text, suggestedTone: 'neutral' });
    }

    case 'speak_done':
      return state.phase === 'speaking' ? same({ ...state, phase: 'feedback' }) : same(state);

    case 'partner_reaction':
      if (!state.lastSpoken) return same(state);
      return {
        state,
        effects: [{ type: 'partner_feedback', spoken: state.lastSpoken, reaction: event.reaction }],
      };

    case 'eye':
      return reduceEye(state, event.event);
  }
}

function proposeTone(state: State, reply: Reply): Result {
  return {
    state: {
      ...state,
      phase: 'confirmTone',
      reply,
      tone: chooseTone(state.mood, state.detected, reply.suggestedTone),
    },
    effects: [{ type: 'snapshot_features' }],
  };
}

function speak(state: State): Result {
  const id = `${state.idPrefix}-${state.utteranceCount + 1}`;
  const spoken: SpokenReply = { id, text: state.reply!.text, tone: state.tone! };
  return {
    state: {
      ...state,
      phase: 'speaking',
      lastSpoken: spoken,
      utteranceCount: state.utteranceCount + 1,
    },
    effects: [{ type: 'speak', spoken }],
  };
}

function reduceEye(state: State, e: EyeEvent): Result {
  if (e.type === 'highlight') return same(state); // display-only; handled by the Orchestrator

  switch (state.phase) {
    case 'selectReply': {
      const shown = visibleSuggestions(state);
      if (e.type === 'select') {
        if (e.optionIndex < shown.length) {
          const s = shown[e.optionIndex];
          return proposeTone(state, { text: s.text, suggestedTone: s.tone });
        }
        if (e.optionIndex === shown.length) return same({ ...state, phase: 'typing' });
      }
      if (e.type === 'cancel') return same({ ...state, phase: 'listening' });
      return same(state);
    }

    case 'typing':
      return e.type === 'cancel'
        ? same({ ...state, phase: state.suggestions.length ? 'selectReply' : 'listening' })
        : same(state);

    case 'confirmTone':
      if (e.type === 'confirm' || (e.type === 'select' && e.optionIndex === 0)) return speak(state);
      if (e.type === 'cancel' || (e.type === 'select' && e.optionIndex === 1)) {
        return same({ ...state, phase: 'pickTone' });
      }
      return same(state);

    case 'pickTone': {
      if (e.type === 'select') {
        const tone = otherTones(state)[e.optionIndex];
        // Back to confirmTone: choosing a tone is not the same as confirming to speak.
        if (tone) return same({ ...state, phase: 'confirmTone', tone });
      }
      if (e.type === 'cancel') return same({ ...state, phase: 'confirmTone' });
      return same(state);
    }

    case 'speaking':
      // Emergency stop. The speak promise then resolves and `speak_done` moves us on.
      return e.type === 'cancel' ? { state, effects: [{ type: 'stop_speaking' }] } : same(state);

    case 'feedback': {
      const ok =
        e.type === 'confirm' || (e.type === 'select' && e.optionIndex === 0)
          ? true
          : e.type === 'cancel' || (e.type === 'select' && e.optionIndex === 1)
            ? false
            : null;
      if (ok === null || !state.lastSpoken) return same(state);
      return {
        state: { ...state, phase: 'listening' },
        effects: [{ type: 'user_feedback', spoken: state.lastSpoken, ok }],
      };
    }

    default:
      return same(state);
  }
}
