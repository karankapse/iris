// ============================================================================
// The conversation state machine. PURE: (state, event) -> (new state, side effects).
// No React, no camera, no network in here, which makes the rules easy to test.
//
//   listening -> suggesting -> selectReply -> confirmTone -> speaking -> feedback -> listening
//        |                        |             |  ^
//        |                        |           pickTone
//        +-- quick phrases / type my own / set mood (also via "More…" from selectReply)
//
// THE SAFETY RULE: the only way into `speaking` is a confirm/select on `confirmTone`.
//
// EVERY screen shows at most 4 options (MAX_OPTIONS). Longer lists are paged: 3 items plus a
// "More…" option that shows the next 3. Each option carries the ACTION it performs, so what is
// shown and what happens can never disagree (see `getEntries`).
// ============================================================================
import { EMOTIONS } from '../contracts';
import type { Emotion, EmotionEstimate, EyeEvent, Suggestion } from '../contracts';
import { MAX_OPTIONS } from '../core/config';
import { applySymbol, DONE, keyboardEntries } from './keyboard';
import { DEFAULT_PHRASES } from './phrases';

export type Phase =
  | 'listening' //   waiting for the partner (the user can also start: phrases / type / mood)
  | 'suggesting' //  waiting for the AI's suggested replies
  | 'selectReply' // pick one of the replies
  | 'menu' //        "More…": quick phrases, type my own, set mood
  | 'phrases' //     quick-access saved phrases
  | 'typing' //      the eye keyboard
  | 'pickMood' //    choose the persistent mood
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
  /** Quick-access phrases (from the user's profile). */
  phrases: string[];
  /** Which page of a long list is showing (tones, moods, phrases). */
  page: number;
  /** Where "back" goes from a sub-screen, most recent last (a stack: menu -> phrases -> back -> back). */
  returnStack: Phase[];
  /** Eye keyboard: the text typed so far, and which group of keys we are inside. */
  typed: string;
  kbPath: number[];
}

export type Event =
  | { type: 'partner_partial'; text: string }
  | { type: 'partner_final'; text: string }
  | { type: 'suggestions_ready'; requestId: number; suggestions: Suggestion[] }
  | { type: 'suggestions_failed'; requestId: number; message: string }
  | { type: 'set_mood'; mood: Emotion | null }
  | { type: 'set_phrases'; phrases: string[] }
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
  | { type: 'save_mood'; mood: Emotion | null }
  | { type: 'speak'; spoken: SpokenReply }
  | { type: 'stop_speaking' }
  | { type: 'user_feedback'; spoken: SpokenReply; ok: boolean }
  | { type: 'partner_feedback'; spoken: SpokenReply; reaction: 'understood' | 'seemed_off' };

export interface Result {
  state: State;
  effects: Effect[];
}

export function initialState(
  mood: Emotion | null = null,
  idPrefix = 'utt',
  phrases: string[] = DEFAULT_PHRASES,
): State {
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
    phrases,
    page: 0,
    returnStack: [],
    typed: '',
    kbPath: [],
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

// ---- paging: at most 4 options per screen ----------------------------------------------------

const PER_PAGE = MAX_OPTIONS - 1; // 3 items + one "More…" option

/** Up to 4 items are shown as they are; longer lists show 3 per page plus a "More…" option. */
export function paged<T>(items: T[], page: number): { shown: T[]; more: boolean } {
  if (items.length <= MAX_OPTIONS) return { shown: items, more: false };
  const pages = Math.ceil(items.length / PER_PAGE);
  const p = ((page % pages) + pages) % pages;
  return { shown: items.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE), more: true };
}

// ---- what is on screen: options that carry their own action -----------------------------------

export interface Option {
  label: string;
  hint?: string;
}

type SubScreen = 'menu' | 'phrases' | 'typing' | 'pickMood';

export type Action =
  | { kind: 'reply'; text: string; tone: Emotion } // a suggestion or phrase: go to tone confirmation
  | { kind: 'goto'; phase: SubScreen }
  | { kind: 'more' } //                              show the next page
  | { kind: 'back' }
  | { kind: 'mood'; mood: Emotion | null }
  | { kind: 'tone'; tone: Emotion }
  | { kind: 'speak' }
  | { kind: 'changeTone' }
  | { kind: 'feedback'; ok: boolean }
  | { kind: 'key'; symbol: string }
  | { kind: 'group'; index: number };

export interface Entry {
  option: Option;
  action: Action;
}

/** Only 3 AI suggestions are shown: the 4th slot is "More…" (phrases, keyboard, mood). */
export const visibleSuggestions = (s: State) => s.suggestions.slice(0, MAX_OPTIONS - 1);
export const otherTones = (s: State) => EMOTIONS.filter((e) => e !== s.tone);

const goto = (label: string, phase: SubScreen): Entry => ({
  option: { label },
  action: { kind: 'goto', phase },
});
const moreEntry = (label: string): Entry => ({ option: { label }, action: { kind: 'more' } });
const backEntry: Entry = { option: { label: '← Back' }, action: { kind: 'back' } };

export function getEntries(s: State): Entry[] {
  switch (s.phase) {
    case 'listening':
      return [
        goto('Quick phrases', 'phrases'),
        goto('Type my own reply', 'typing'),
        goto(s.mood ? `Mood: ${s.mood} (change)` : 'Set mood', 'pickMood'),
      ];

    case 'selectReply':
      return [
        ...visibleSuggestions(s).map((x): Entry => ({
          option: { label: x.text, hint: x.tone },
          action: { kind: 'reply', text: x.text, tone: x.tone },
        })),
        goto('More…', 'menu'),
      ];

    case 'menu':
      return [
        goto('Quick phrases', 'phrases'),
        goto('Type my own reply', 'typing'),
        goto('Set mood', 'pickMood'),
        backEntry,
      ];

    case 'phrases': {
      if (s.phrases.length === 0) {
        return [
          { option: { label: 'No phrases yet: add some in the menu' }, action: { kind: 'back' } },
        ];
      }
      const { shown, more } = paged(s.phrases, s.page);
      const entries = shown.map((text): Entry => ({
        option: { label: text },
        action: { kind: 'reply', text, tone: 'neutral' },
      }));
      return more ? [...entries, moreEntry('More phrases →')] : entries;
    }

    case 'pickMood': {
      const items: { mood: Emotion | null; label: string }[] = [
        { mood: null, label: 'No mood (automatic)' },
        ...EMOTIONS.map((e) => ({ mood: e as Emotion | null, label: e })),
      ];
      const { shown, more } = paged(items, s.page);
      const entries = shown.map((i): Entry => ({
        option: { label: i.mood === s.mood ? `${i.label} ✓` : i.label },
        action: { kind: 'mood', mood: i.mood },
      }));
      return more ? [...entries, moreEntry('More moods →')] : entries;
    }

    case 'pickTone': {
      const { shown, more } = paged(otherTones(s), s.page);
      const entries = shown.map((tone): Entry => ({
        option: { label: tone },
        action: { kind: 'tone', tone },
      }));
      return more ? [...entries, moreEntry('More tones →')] : entries;
    }

    case 'confirmTone':
      return [
        { option: { label: `Speak it (${s.tone})` }, action: { kind: 'speak' } },
        { option: { label: 'Change tone' }, action: { kind: 'changeTone' } },
      ];

    case 'feedback':
      return [
        { option: { label: 'Yes, that tone was right' }, action: { kind: 'feedback', ok: true } },
        { option: { label: 'No, it was off' }, action: { kind: 'feedback', ok: false } },
      ];

    case 'typing':
      return keyboardEntries(s.kbPath).map((e): Entry =>
        e.kind === 'group'
          ? { option: { label: e.label }, action: { kind: 'group', index: e.index } }
          : { option: { label: e.label }, action: { kind: 'key', symbol: e.symbol } },
      );

    default:
      return [];
  }
}

export const getOptions = (s: State): Option[] => getEntries(s).map((e) => e.option);

// ---- the reducer ---------------------------------------------------------------------------------

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
          page: 0,
          typed: '',
          kbPath: [],
          returnStack: [],
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

    case 'set_phrases':
      return same({ ...state, phrases: event.phrases });

    case 'emotion_estimate':
      return same({ ...state, detected: event.estimate });

    case 'error':
      // Several parts can fail at once (camera AND microphone): show all, without repeats.
      return same({
        ...state,
        error:
          state.error && !state.error.includes(event.message)
            ? `${state.error} · ${event.message}`
            : (state.error ?? event.message),
      });

    case 'dismiss_error':
      return same({ ...state, error: null });

    case 'custom_reply': {
      // A caregiver typing the reply in the text box instead of using the eye keyboard.
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
      returnStack: [],
      page: 0,
      typed: '',
      kbPath: [],
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

/** Pop one level off the "where did I come from" stack (listening if there is nothing to go back to). */
function leaveSubScreen(state: State): State {
  const stack = state.returnStack;
  return {
    ...state,
    phase: stack.at(-1) ?? 'listening',
    returnStack: stack.slice(0, -1),
    page: 0,
    typed: '',
    kbPath: [],
  };
}

/** "Back" / cancel: one step back, depending on where we are. */
function goBack(state: State): Result {
  switch (state.phase) {
    case 'typing':
      // inside a group of keys: back out of the group first; at the top: leave the keyboard
      return state.kbPath.length > 0
        ? same({ ...state, kbPath: state.kbPath.slice(0, -1) })
        : same(leaveSubScreen(state));
    case 'menu':
    case 'phrases':
    case 'pickMood':
      return same(leaveSubScreen(state));
    case 'selectReply':
      return same({ ...state, phase: 'listening' });
    case 'confirmTone':
      return same({ ...state, phase: 'pickTone', page: 0 });
    case 'pickTone':
      return same({ ...state, phase: 'confirmTone', page: 0 });
    case 'speaking':
      // Emergency stop. The speak promise then resolves and `speak_done` moves us on.
      return { state, effects: [{ type: 'stop_speaking' }] };
    case 'feedback':
      return state.lastSpoken
        ? {
            state: { ...state, phase: 'listening' },
            effects: [{ type: 'user_feedback', spoken: state.lastSpoken, ok: false }],
          }
        : same(state);
    default:
      return same(state);
  }
}

function applyAction(state: State, action: Action): Result {
  switch (action.kind) {
    case 'reply':
      return proposeTone(state, { text: action.text, suggestedTone: action.tone });

    case 'goto':
      return same({
        ...state,
        phase: action.phase,
        returnStack: [...state.returnStack, state.phase],
        page: 0,
        typed: '',
        kbPath: [],
      });

    case 'more':
      return same({ ...state, page: state.page + 1 });

    case 'back':
      return goBack(state);

    case 'mood':
      return {
        state: { ...leaveSubScreen(state), mood: action.mood },
        effects: [{ type: 'save_mood', mood: action.mood }],
      };

    case 'tone':
      // Back to confirmTone: choosing a tone is not the same as confirming to speak.
      return same({ ...state, phase: 'confirmTone', tone: action.tone, page: 0 });

    case 'speak':
      return speak(state);

    case 'changeTone':
      return same({ ...state, phase: 'pickTone', page: 0 });

    case 'feedback':
      if (!state.lastSpoken) return same(state);
      return {
        state: { ...state, phase: 'listening' },
        effects: [{ type: 'user_feedback', spoken: state.lastSpoken, ok: action.ok }],
      };

    case 'group':
      return same({ ...state, kbPath: [...state.kbPath, action.index] });

    case 'key':
      if (action.symbol === DONE) {
        const text = state.typed.trim();
        return text ? proposeTone(state, { text, suggestedTone: 'neutral' }) : same(state);
      }
      return same({ ...state, typed: applySymbol(state.typed, action.symbol), kbPath: [] });
  }
}

function reduceEye(state: State, e: EyeEvent): Result {
  if (e.type === 'highlight') return same(state); // display-only; handled by the Orchestrator

  if (e.type === 'select') {
    const entry = getEntries(state)[e.optionIndex];
    return entry ? applyAction(state, entry.action) : same(state);
  }

  if (e.type === 'confirm') {
    // "Yes": speak on the tone screen, or "the tone was right" on the feedback screen.
    if (state.phase === 'confirmTone') return applyAction(state, { kind: 'speak' });
    if (state.phase === 'feedback') return applyAction(state, { kind: 'feedback', ok: true });
    return same(state);
  }

  return goBack(state); // cancel
}
