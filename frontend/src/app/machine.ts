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
import type {
  ConversationEmotion,
  Emotion,
  EmotionEstimate,
  EyeEvent,
  Suggestion,
} from '../contracts';
import { MAX_OPTIONS } from '../core/config';
import { applySymbol, DONE, keyboardEntries, LETTERS } from './keyboard';
import { DEFAULT_PHRASES } from './phrases';

export type Phase =
  | 'listening' //   waiting for the partner (the user can also start: phrases / type / other)
  | 'suggesting' //  waiting for the AI's suggested replies
  | 'selectReply' // pick one of the replies
  | 'moreReplies' // the AI's other suggestions (from "Other…")
  | 'menu' //        "Other…": quick phrases, type my own, set mood
  | 'phrases' //     quick-access saved phrases
  | 'typing' //      the eye keyboard (exact spelling)
  | 'quickType' //   first-letter typing: type the first letter of each word, the AI guesses
  | 'qtMore' //      more guesses, delete, spell exactly, start over
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
  /** The replies loading are for held (older) speech: anything the partner says now is newer
   * and replaces them, so the conversation never falls a statement behind. */
  catchingUp: boolean;
  /** When the partner last finished a sentence (ms), to tell a follow-up from other talk. */
  lastPartnerAt: number | null;
  /** Speech heard while replies load, waiting on "is it related?" (see check_related). */
  pendingRelated: string;
  /** How many times this turn's replies were restarted by follow-up speech (max MAX_RESTARTS). */
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
  /** How this moment feels, from the partner's words AND the user's face (null until known). */
  feel: ConversationEmotion | null;
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
  /** First-letter typing: the letters so far ("iww"), the AI's guesses for them, and whether
   * the letter picker is showing (vs. the "best guess / next letter / other" screen). */
  initials: string;
  expansions: Suggestion[];
  expandId: number;
  expanding: boolean;
  qtPicking: boolean;
}

export type Event =
  | { type: 'partner_partial'; text: string }
  | { type: 'partner_final'; text: string; /** when it was heard (ms) */ at?: number }
  | { type: 'related_result'; requestId: number; related: boolean; text: string }
  | {
      type: 'suggestions_ready';
      requestId: number;
      suggestions: Suggestion[];
      reaction?: Emotion | null;
      feel?: ConversationEmotion | null;
    }
  | { type: 'suggestions_failed'; requestId: number; message: string }
  | { type: 'expansions_ready'; requestId: number; suggestions: Suggestion[] }
  | { type: 'expansions_failed'; requestId: number; message: string }
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
  | { type: 'check_related'; requestId: number; previous: string; new: string }
  | { type: 'expand'; requestId: number; initials: string; mood: Emotion | null }
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
    catchingUp: false,
    lastPartnerAt: null,
    pendingRelated: '',
    restarts: 0,
    suggestions: [],
    requestId: 0,
    reply: null,
    tone: null,
    mood,
    detected: { emotion: 'neutral', confidence: 0 },
    measuredEmotion: null,
    feel: null,
    lastSpoken: null,
    utteranceCount: 0,
    idPrefix,
    error: null,
    phrases,
    page: 0,
    returnStack: [],
    typed: '',
    kbPath: [],
    initials: '',
    expansions: [],
    expandId: 0,
    expanding: false,
    qtPicking: true,
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

type SubScreen =
  'menu' | 'moreReplies' | 'phrases' | 'typing' | 'quickType' | 'qtMore' | 'pickMood';

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
  | { kind: 'group'; index: number }
  | { kind: 'initial'; letter: string } // first-letter typing: add this letter
  | { kind: 'qtLetter' } //                show the letter picker
  | { kind: 'qtDelete' }
  | { kind: 'qtClear' };

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
      // Nothing to choose until the partner speaks: resting eyes must not open menus by accident.
      // (Quick phrases, the keyboard and mood are under "Other…" once replies appear.)
      return [
        info('Listening…'),
        info(s.interim ? `“${s.interim}”` : 'Waiting for them to speak'),
        info('Replies will appear here'),
      ];

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
          : [goto('Quick phrases', 'phrases'), goto('Type my own reply', 'quickType')]),
        // exact spelling (names, unusual words), always one step away
        goto('Spell it exactly', 'typing'),
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

    case 'quickType': {
      // picking a letter: the same 3-way letter groups as the keyboard (letters only)
      if (s.qtPicking || !s.initials) {
        return keyboardEntries(s.kbPath, LETTERS).map((e): Entry =>
          e.kind === 'group'
            ? { option: { label: e.label }, action: { kind: 'group', index: e.index } }
            : e.kind === 'symbol'
              ? { option: { label: e.label }, action: { kind: 'initial', letter: e.symbol } }
              : backEntry,
        );
      }
      const letters = s.initials.toUpperCase().split('').join(' ');
      const best = s.expansions[0];
      const first: Entry = best
        ? replyEntry(best.text, s.measuredEmotion ?? best.tone, `✓ best guess (${letters})`)
        : s.expanding
          ? info('Guessing…', letters)
          : info('No guess yet', 'add another letter');
      return [
        first,
        { option: { label: 'Next letter' }, action: { kind: 'qtLetter' } },
        other('qtMore'),
      ];
    }

    case 'qtMore':
      return threeOf(
        [
          ...s.expansions
            .slice(1)
            .map((x) => replyEntry(x.text, s.measuredEmotion ?? x.tone, 'guess')),
          { option: { label: '⌫ Delete last letter' }, action: { kind: 'qtDelete' } },
          goto('Spell it exactly', 'typing'),
          { option: { label: 'Start over' }, action: { kind: 'qtClear' } },
          backEntry,
        ],
        s.page,
      );

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

/** Screens where new partner speech starts a turn right away. While the user is choosing (replies,
 * menus, keyboard) it is held for later, so replies don't change under their eyes. */
const TAKES_PARTNER_SPEECH: Phase[] = ['listening', 'feedback'];

/** A lone word like "yeah" or "um" is background noise, not a sentence (unless it's a question). */
export function isRealSentence(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  return words.length >= 2 || (words.length === 1 && text.trim().endsWith('?'));
}

const same = (state: State): Result => ({ state, effects: [] });

export function reduce(state: State, event: Event): Result {
  const result = reduceEvent(state, event);
  // Speech heard while the user was busy is handled as soon as they're free again.
  const next = result.state;
  if (next.phase === 'listening' && next.heldPartner && state.phase !== 'listening') {
    const text = next.heldPartner.replace(/^… /, '');
    const held = startSuggesting({ ...next, heldPartner: '' }, text, text);
    return {
      state: { ...held.state, catchingUp: true },
      effects: [...result.effects, ...held.effects],
    };
  }
  return result;
}

/** Only a clear read of the moment overrides each reply's own tone (so replies keep variety). */
export const FEEL_TRUST = 0.7;

/** The tone the moment calls for (words + face), if it's clear and not just "neutral". */
function feelTone(feel: ConversationEmotion | null | undefined): Emotion | null {
  if (!feel || feel.emotion === 'neutral' || feel.confidence < FEEL_TRUST) return null;
  return feel.emotion;
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

/** Follow-up speech may restart a turn's replies at most this often (a TV would never stop). */
export const MAX_RESTARTS = 2;
/** A sentence this soon after the last one is the same person still talking. */
export const FOLLOW_UP_MS = 3000;
const CONNECTORS = ['and', 'or', 'but', 'also', 'so', 'because', 'plus'];
const REFERS_BACK = ['it', "it's", 'that', "that's", 'them', 'this', 'those'];

/** Cheap, offline rules for "is this the same turn?". false = not sure (ask the backend). */
export function obviouslyRelated(text: string, gapMs: number | null): boolean {
  if (gapMs !== null && gapMs <= FOLLOW_UP_MS) return true;
  const first =
    text
      .trim()
      .toLowerCase()
      .replace(/’/g, "'")
      .split(/[\s,.!?]+/)[0] ?? '';
  return CONNECTORS.includes(first) || REFERS_BACK.includes(first);
}

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
      catchingUp: false,
      partnerText: shown,
      interim: '',
      suggestions: [],
      reply: null,
      tone: null,
      measuredEmotion: reaction,
      feel: null,
      requestId,
      restarts: restart ? state.restarts + 1 : 0,
      // a check still running belongs to the old request: keep its text for later
      heldPartner: state.pendingRelated
        ? lastWords(`${state.heldPartner} ${state.pendingRelated}`)
        : state.heldPartner,
      pendingRelated: '',
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
      const text = event.text.trim();
      // While the app is speaking, ignore the room (it would also hear its own voice), and a lone
      // "yeah" / "um" is background noise, not a turn.
      if (!isRealSentence(text) || state.phase === 'speaking') return same(state);
      const at = event.at ?? null;
      const gap = at !== null && state.lastPartnerAt !== null ? at - state.lastPartnerAt : null;
      const heard = { ...state, lastPartnerAt: at ?? state.lastPartnerAt };
      if (state.phase === 'suggesting') {
        // Still loading replies to older, held speech: this is newer, answer it instead
        // (the held words are already in the conversation history).
        if (state.catchingUp) return startSuggesting(heard, text, text);
        // Enough restarts for this turn, or a check already running: answer it afterwards.
        if (state.restarts >= MAX_RESTARTS || state.pendingRelated) return same(hold(heard, text));
        // A follow-up ("Are you hungry?" ... "We have soup."): same turn, ask again with all of it.
        if (obviouslyRelated(text, gap)) {
          return startSuggesting(heard, `${state.partnerText} ${text}`, text, true);
        }
        // Not sure (could be the TV): ask, while the replies keep loading.
        return {
          state: { ...heard, pendingRelated: text, interim: '' },
          effects: [
            {
              type: 'check_related',
              requestId: state.requestId,
              previous: state.partnerText,
              new: text,
            },
          ],
        };
      }
      // The user is choosing or typing a reply: don't change the screen under their eyes.
      // Hold it, and handle it as soon as they're done (see reduce()).
      if (!TAKES_PARTNER_SPEECH.includes(state.phase)) return same(hold(heard, text));
      return startSuggesting(heard, text, text);
    }

    case 'related_result': {
      const stale =
        event.requestId !== state.requestId ||
        state.phase !== 'suggesting' ||
        event.text !== state.pendingRelated;
      if (stale) return same(state); // its text was already held (see startSuggesting / replies)
      const next = { ...state, pendingRelated: '' };
      if (event.related && state.restarts < MAX_RESTARTS) {
        return startSuggesting(next, `${state.partnerText} ${event.text}`, event.text, true);
      }
      return same(hold(next, event.text));
    }

    case 'suggestions_ready':
      if (event.requestId !== state.requestId || state.phase !== 'suggesting') return same(state);
      if (event.suggestions.length === 0) {
        return same({ ...state, phase: 'listening', error: 'The AI returned no suggestions.' });
      }
      return same({
        // replies came first: speech still being checked is answered after this reply
        ...(state.pendingRelated ? hold(state, state.pendingRelated) : state),
        pendingRelated: '',
        phase: 'selectReply',
        suggestions: event.suggestions,
        feel: event.feel ?? null,
        measuredEmotion:
          feelTone(event.feel) ??
          (event.reaction !== undefined ? event.reaction : state.measuredEmotion),
      });

    case 'suggestions_failed':
      if (event.requestId !== state.requestId || state.phase !== 'suggesting') return same(state);
      return same({
        ...(state.pendingRelated ? hold(state, state.pendingRelated) : state),
        pendingRelated: '',
        phase: 'listening',
        error: event.message,
      });

    case 'expansions_ready':
      if (event.requestId !== state.expandId) return same(state); // an older guess: ignore
      return same({ ...state, expansions: event.suggestions, expanding: false });

    case 'expansions_failed':
      if (event.requestId !== state.expandId) return same(state);
      return same({ ...state, expanding: false, error: event.message });

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
      // the caregiver's text box works on any typing screen
      if (!['typing', 'quickType', 'qtMore'].includes(state.phase) || !text) return same(state);
      return proposeTone(state, { text, suggestedTone: 'neutral' });
    }

    case 'speak_done':
      // Straight back to listening: the conversation keeps flowing (no "was the tone right?" step).
      return state.phase === 'speaking' ? same({ ...state, phase: 'listening' }) : same(state);

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
/** Set the first letters and ask the AI for guesses (none needed when there are no letters). */
function withInitials(state: State, initials: string): Result {
  const base = { ...state, initials, kbPath: [], qtPicking: initials === '', expansions: [] };
  if (!initials) return same({ ...base, expanding: false });
  const expandId = state.expandId + 1;
  return {
    state: { ...base, expandId, expanding: true },
    effects: [{ type: 'expand', requestId: expandId, initials, mood: state.mood }],
  };
}

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
    case 'quickType':
      // inside a letter group: back out of it; picking a letter: back to the guess; else leave
      if (state.kbPath.length > 0) return same({ ...state, kbPath: state.kbPath.slice(0, -1) });
      if (state.qtPicking && state.initials) return same({ ...state, qtPicking: false });
      return same(leaveSubScreen(state));
    case 'typing':
      // inside a group of keys: back out of the group first; at the top: leave the keyboard
      return state.kbPath.length > 0
        ? same({ ...state, kbPath: state.kbPath.slice(0, -1) })
        : same(leaveSubScreen(state));
    case 'menu':
    case 'moreReplies':
    case 'phrases':
    case 'pickMood':
    case 'qtMore':
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
        // opening first-letter typing starts fresh
        ...(action.phase === 'quickType'
          ? { initials: '', expansions: [], expanding: false, qtPicking: true }
          : {}),
      });

    case 'initial':
      return withInitials(state, state.initials + action.letter.toLowerCase());

    case 'qtLetter':
      return same({ ...state, qtPicking: true, kbPath: [] });

    case 'qtDelete':
      return withInitials(leaveSubScreen(state), state.initials.slice(0, -1));

    case 'qtClear':
      return withInitials(leaveSubScreen(state), '');

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
