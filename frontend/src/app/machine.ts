// ============================================================================
// The conversation state machine. PURE: (state, event) -> (new state, side effects).
// No React, no camera, no network in here, which makes the rules easy to test.
//
//   listening -> suggesting -> selectReply -> confirmTone -> speaking -> feedback -> listening
//        |                        |             |  ^
//        |                        |           pickTone
//        +-- quick phrases / type my own / "Other…" (menu, mood, more replies)
//
// THE SAFETY RULE: the only way into `speaking` is a confirm/select on `confirmTone`.
//
// EVERY screen shows EXACTLY 3 options (MAX_OPTIONS), never fewer, so there are no blank slots.
// The third is always "Other…": it opens a menu, or shows the next page of a long list. Lists that
// are too short are filled up (with "← Back" or info cards). Each option carries the ACTION it
// performs, so what is shown and what happens can never disagree (see `getEntries`).
// ============================================================================
import { EMOTIONS } from '../contracts';
import type { Emotion, EmotionEstimate, EyeEvent, Suggestion } from '../contracts';
import { MAX_OPTIONS } from '../core/config';
import { applySymbol, DONE, keyboardEntries } from './keyboard';
import { DEFAULT_PHRASES } from './phrases';

export type Phase =
  | 'listening' //   waiting for the partner (the user can also start: phrases / type / other)
  | 'suggesting' //  waiting for the AI's suggested replies
  | 'selectReply' // pick one of the replies
  | 'moreReplies' // the AI's other suggestions (from "Other…")
  | 'menu' //        "Other…": quick phrases, type my own, set mood
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
  /** What the partner said while the user was busy choosing or typing a reply. It is held (the
   * options don't change under their eyes) and handled as soon as they are free again. */
  heldPartner: string;
  /** How many times this turn's replies were restarted by more speech (max MAX_RESTARTS). */
  restarts: number;
  suggestions: Suggestion[];
  /** Increases per request so a slow, old response can't overwrite a newer one. */
  requestId: number;
  reply: Reply | null;
  /** The tone currently proposed in confirmTone. */
  tone: Emotion | null;
  /** Persistent mood setting: saves the user from choosing a tone every time. */
  mood: Emotion | null;
  detected: EmotionEstimate;
  /** The emotion measured right after the partner spoke. */
  measuredEmotion: Emotion | null;
  lastSpoken: SpokenReply | null;
  utteranceCount: number;
  idPrefix: string;
  error: string | null;
  /** Quick-access phrases (from the user's profile). */
  phrases: string[];
  /** Which page of a long list is showing (tones, moods, phrases...). */
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
  | {
      type: 'suggestions_ready';
      requestId: number;
      suggestions: Suggestion[];
      reaction?: Emotion | null;
    }
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
  | {
      type: 'suggest';
      requestId: number;
      partnerText: string;
      mood: Emotion | null;
      reaction: Emotion | null;
    }
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
    heldPartner: '',
    restarts: 0,
    suggestions: [],
    requestId: 0,
    reply: null,
    tone: null,
    mood,
    detected: { emotion: 'neutral', confidence: 0 },
    measuredEmotion: null,
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

// ---- what is on screen: options that carry their own action -----------------------------------

export interface Option {
  label: string;
  hint?: string;
  /** An info card: fills a slot but cannot be chosen (used while thinking or speaking). */
  info?: boolean;
}

type SubScreen = 'menu' | 'moreReplies' | 'phrases' | 'typing' | 'pickMood';

export type Action =
  | { kind: 'none' } //                               info card: nothing happens
  | { kind: 'reply'; text: string; tone: Emotion } // a suggestion or phrase: go to tone confirmation
  | { kind: 'goto'; phase: SubScreen }
  | { kind: 'more' } //                               show the next page
  | { kind: 'back' }
  | { kind: 'mood'; mood: Emotion | null }
  | { kind: 'tone'; tone: Emotion }
  | { kind: 'speak' }
  | { kind: 'stop' }
  | { kind: 'changeTone' }
  | { kind: 'discardReply' }
  | { kind: 'feedback'; ok: boolean }
  | { kind: 'skipFeedback' }
  | { kind: 'key'; symbol: string }
  | { kind: 'group'; index: number };

export interface Entry {
  option: Option;
  action: Action;
}

/** The AI suggestions that fit in the first two slots; the rest are under "Other…". */
export const visibleSuggestions = (s: State) => s.suggestions.slice(0, MAX_OPTIONS - 1);
export const otherTones = (s: State) => EMOTIONS.filter((e) => e !== s.tone);

const goto = (label: string, phase: SubScreen): Entry => ({
  option: { label },
  action: { kind: 'goto', phase },
});
const other = (phase: SubScreen = 'menu'): Entry => goto('Other…', phase);
const backEntry: Entry = { option: { label: '← Back' }, action: { kind: 'back' } };
const info = (label: string, hint?: string): Entry => ({
  option: { label, hint, info: true },
  action: { kind: 'none' },
});
const replyEntry = (text: string, tone: Emotion, hint?: string): Entry => ({
  option: { label: text, hint },
  action: { kind: 'reply', text, tone },
});

/**
 * Exactly 3 entries from a list of any length:
 *  - exactly 3: as they are
 *  - more: 2 per page plus "Other →" (next page; it cycles, and the last page wraps around so it is
 *    never short)
 *  - fewer: filled up from `fillers` (default: "← Back")
 */
function threeOf(entries: Entry[], page: number, fillers: Entry[] = [backEntry]): Entry[] {
  const n = entries.length;
  if (n > MAX_OPTIONS) {
    const per = MAX_OPTIONS - 1;
    const pages = Math.ceil(n / per);
    const start = (((page % pages) + pages) % pages) * per;
    return [
      entries[start % n],
      entries[(start + 1) % n],
      { option: { label: 'Other →' }, action: { kind: 'more' } },
    ];
  }
  const out = [...entries];
  for (const f of fillers) if (out.length < MAX_OPTIONS) out.push(f);
  while (out.length < MAX_OPTIONS) out.push(backEntry);
  return out;
}

export function getEntries(s: State): Entry[] {
  switch (s.phase) {
    case 'listening':
      return [goto('Quick phrases', 'phrases'), goto('Type my own reply', 'typing'), other()];

    case 'selectReply': {
      // The two best AI suggestions. If there are fewer than two, quick phrases fill the gap.
      const pool: Entry[] = [
        ...s.suggestions.map((x) => {
          const tone = s.measuredEmotion ?? x.tone;
          return replyEntry(x.text, tone, tone);
        }),
        ...s.phrases.map((p) => {
          const tone = s.measuredEmotion ?? s.mood ?? 'neutral';
          return replyEntry(p, tone, s.measuredEmotion ? `${s.measuredEmotion}` : 'quick phrase');
        }),
      ];
      const two = pool.slice(0, MAX_OPTIONS - 1);
      while (two.length < MAX_OPTIONS - 1) two.push(info('No suggestions yet'));
      return [...two, other()];
    }

    case 'menu': {
      // Don't repeat what the previous screen already offered (the listening screen shows
      // "Quick phrases" and "Type my own reply" directly), so the useful items come first.
      const from = s.returnStack.at(-1);
      const items: Entry[] = [
        ...(s.suggestions.length > MAX_OPTIONS - 1 && from === 'selectReply'
          ? [goto('More replies', 'moreReplies')]
          : []),
        ...(from === 'listening'
          ? []
          : [goto('Quick phrases', 'phrases'), goto('Type my own reply', 'typing')]),
        goto('Set mood', 'pickMood'),
        backEntry,
      ];
      return threeOf(items, s.page);
    }

    case 'moreReplies':
      return threeOf(
        [
          ...s.suggestions.slice(MAX_OPTIONS - 1).map((x) => {
            const tone = s.measuredEmotion ?? x.tone;
            return replyEntry(x.text, tone, tone);
          }),
          backEntry,
        ],
        s.page,
      );

    case 'phrases':
      if (s.phrases.length === 0) {
        return [info('No quick phrases yet'), info('Add some in the Menu'), backEntry];
      }
      return threeOf([...s.phrases.map((p) => replyEntry(p, 'neutral')), backEntry], s.page);

    case 'pickMood': {
      const items: { mood: Emotion | null; label: string }[] = [
        { mood: null, label: 'No mood (automatic)' },
        ...EMOTIONS.map((e) => ({ mood: e as Emotion | null, label: e })),
      ];
      return threeOf(
        [
          ...items.map((i): Entry => ({
            option: { label: i.mood === s.mood ? `${i.label} ✓` : i.label },
            action: { kind: 'mood', mood: i.mood },
          })),
          backEntry,
        ],
        s.page,
      );
    }

    case 'pickTone':
      return threeOf(
        [
          ...otherTones(s).map((tone): Entry => ({
            option: { label: tone },
            action: { kind: 'tone', tone },
          })),
          backEntry,
        ],
        s.page,
      );

    case 'confirmTone':
      return [
        { option: { label: `Speak it (${s.tone})` }, action: { kind: 'speak' } },
        { option: { label: 'Change tone' }, action: { kind: 'changeTone' } },
        { option: { label: 'Other reply…' }, action: { kind: 'discardReply' } },
      ];

    case 'feedback':
      return [
        { option: { label: 'Yes, that tone was right' }, action: { kind: 'feedback', ok: true } },
        { option: { label: 'No, it was off' }, action: { kind: 'feedback', ok: false } },
        { option: { label: 'Not sure (skip)' }, action: { kind: 'skipFeedback' } },
      ];

    case 'typing':
      return keyboardEntries(s.kbPath).map((e): Entry =>
        e.kind === 'group'
          ? { option: { label: e.label }, action: { kind: 'group', index: e.index } }
          : e.kind === 'symbol'
            ? { option: { label: e.label }, action: { kind: 'key', symbol: e.symbol } }
            : backEntry,
      );

    // Nothing can be chosen right now, but the three slots are still filled: info cards.
    case 'suggesting':
      return [info('They said', s.partnerText), info('Thinking of replies…'), info('One moment')];

    case 'speaking':
      return [
        { option: { label: 'Stop speaking' }, action: { kind: 'stop' } },
        info(s.reply ? `“${s.reply.text}”` : 'Speaking…'),
        info(s.tone ? `Tone: ${s.tone}` : 'Speaking'),
      ];
  }
}

export const getOptions = (s: State): Option[] => getEntries(s).map((e) => e.option);

// ---- the reducer ---------------------------------------------------------------------------------

const same = (state: State): Result => ({ state, effects: [] });

export function reduce(state: State, event: Event): Result {
  const result = reduceEvent(state, event);
  // Speech heard while the user was busy is handled as soon as they're free again.
  const next = result.state;
  if (next.phase === 'listening' && next.heldPartner && state.phase !== 'listening') {
    const text = next.heldPartner.replace(/^… /, '');
    const held = startSuggesting({ ...next, heldPartner: '' }, text, text);
    return { state: held.state, effects: [...result.effects, ...held.effects] };
  }
  return result;
}

/** Speech held while the user is busy is kept short: only the most recent words matter. */
const HELD_WORDS = 20;
function lastWords(text: string, n = HELD_WORDS): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return (words.length > n ? '… ' : '') + words.slice(-n).join(' ');
}

const hold = (state: State, text: string): State => ({
  ...state,
  heldPartner: lastWords(`${state.heldPartner} ${text}`),
  interim: '',
});

/** More speech may restart a turn's replies at most this often (a TV would never stop). */
export const MAX_RESTARTS = 2;

/**
 * Start preparing replies. `shown` is the partner's whole turn (what the screen shows); `added`
 * is the part that is new (it goes into the conversation history once). `restart`: the same
 * turn continued (counts toward MAX_RESTARTS) rather than a new turn.
 */
function startSuggesting(state: State, shown: string, added: string, restart = false): Result {
  const requestId = state.requestId + 1;
  const reaction =
    state.detected.confidence >= MIN_DETECTION_CONFIDENCE
      ? state.detected.emotion
      : (state.mood ?? null);
  return {
    state: {
      ...state,
      phase: 'suggesting',
      partnerText: shown,
      interim: '',
      suggestions: [],
      reply: null,
      tone: null,
      measuredEmotion: reaction,
      requestId,
      restarts: restart ? state.restarts + 1 : 0,
      error: null,
      page: 0,
      typed: '',
      kbPath: [],
      returnStack: [],
    },
    effects: [{ type: 'suggest', requestId, partnerText: added, mood: state.mood, reaction }],
  };
}

function reduceEvent(state: State, event: Event): Result {
  switch (event.type) {
    case 'partner_partial':
      return same({ ...state, interim: event.text });

    case 'partner_final': {
      const text = (event.text || state.interim || "").trim();
      // While the app is speaking, ignore the room (it would also hear its own voice).
      if (!text || state.phase === 'speaking') return same(state);
      if (state.phase === 'suggesting') {
        // Still preparing replies: it's the same turn ("Are you hungry? We have soup."), so ask
        // again with all of it, but only a couple of times (constant chatter would never finish).
        if (state.restarts >= MAX_RESTARTS) return same(hold(state, text));
        return startSuggesting(state, `${state.partnerText} ${text}`, text, true);
      }
      // The user is choosing or typing a reply: don't change the screen under their eyes.
      // Hold it, and handle it as soon as they're done (see reduce()).
      if (state.phase !== 'listening') return same(hold(state, text));
      return startSuggesting(state, text, text);
    }

    case 'suggestions_ready':
      if (event.requestId !== state.requestId || state.phase !== 'suggesting') return same(state);
      if (event.suggestions.length === 0) {
        return same({ ...state, phase: 'listening', error: 'The AI returned no suggestions.' });
      }
      return same({
        ...state,
        phase: 'selectReply',
        suggestions: event.suggestions,
        measuredEmotion: event.reaction !== undefined ? event.reaction : state.measuredEmotion,
      });

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
      const text = (event.text || state.interim || "").trim();
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

function speakReply(state: State, text: string, tone: Emotion): Result {
  const id = `${state.idPrefix}-${state.utteranceCount + 1}`;
  const spoken: SpokenReply = { id, text, tone };
  return {
    state: {
      ...state,
      phase: 'speaking',
      reply: { text, suggestedTone: tone },
      tone,
      lastSpoken: spoken,
      utteranceCount: state.utteranceCount + 1,
      page: 0,
      typed: '',
      kbPath: [],
      returnStack: [],
    },
    effects: [{ type: 'snapshot_features' }, { type: 'speak', spoken }],
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
    case 'moreReplies':
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
    case 'none':
      return same(state);

    case 'reply':
      if (state.phase === 'selectReply' || state.phase === 'moreReplies') {
        const tone = state.measuredEmotion ?? chooseTone(state.mood, state.detected, action.tone);
        return speakReply(state, action.text, tone);
      }
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

    case 'stop':
      return { state, effects: [{ type: 'stop_speaking' }] };

    case 'changeTone':
      return same({ ...state, phase: 'pickTone', page: 0 });

    case 'discardReply':
      // "Other reply…": drop this one and pick again
      return same({
        ...state,
        phase: state.suggestions.length > 0 ? 'selectReply' : 'listening',
        reply: null,
        tone: null,
        returnStack: [],
        page: 0,
      });

    case 'feedback':
      if (!state.lastSpoken) return same(state);
      return {
        state: { ...state, phase: 'listening' },
        effects: [{ type: 'user_feedback', spoken: state.lastSpoken, ok: action.ok }],
      };

    case 'skipFeedback':
      return same({ ...state, phase: 'listening' });

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
