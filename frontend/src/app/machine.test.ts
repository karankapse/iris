import { describe, expect, it } from 'vitest';
import { EMOTIONS } from '../contracts';
import type { Suggestion } from '../contracts';
import { DONE, SPACE, symbolsAt } from './keyboard';
import {
  chooseTone,
  getEntries,
  getOptions,
  initialState,
  paged,
  reduce,
  type Effect,
  type Event,
  type State,
} from './machine';

const sug = (i: number, tone: Suggestion['tone'] = 'neutral'): Suggestion => ({
  id: `${i}`,
  text: `reply ${i}`,
  tone,
});

/** Feed events one by one; return the final state and every effect produced. */
function run(events: Event[], from: State = initialState()) {
  let state = from;
  const effects: Effect[] = [];
  for (const e of events) {
    const r = reduce(state, e);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}

const eye = (event: Extract<Event, { type: 'eye' }>['event']): Event => ({ type: 'eye', event });
const select = (i: number) => eye({ type: 'select', optionIndex: i });
const labels = (s: State) => getOptions(s).map((o) => o.label);
/** Select the option with this exact label. */
const choose = (s: State, label: string) => {
  const i = labels(s).indexOf(label);
  if (i === -1) throw new Error(`no option "${label}" in ${JSON.stringify(labels(s))}`);
  return run([select(i)], s).state;
};

/** Partner speaks and 3 suggestions arrive. */
const atSelectReply = (mood: State['mood'] = null) =>
  run(
    [
      { type: 'partner_final', text: 'How are you?' },
      {
        type: 'suggestions_ready',
        requestId: 1,
        suggestions: [sug(1, 'happy'), sug(2), sug(3, 'sad')],
      },
    ],
    initialState(mood),
  ).state;

/** Type one symbol on the eye keyboard by following the groups that contain it. */
function typeSymbol(s: State, symbol: string): State {
  for (let guard = 0; guard < 6; guard++) {
    const entries = getEntries(s);
    const direct = entries.findIndex((e) => e.action.kind === 'key' && e.action.symbol === symbol);
    if (direct !== -1) return run([select(direct)], s).state;
    const group = entries.findIndex(
      (e) => e.action.kind === 'group' && symbolsAt([...s.kbPath, e.action.index]).includes(symbol),
    );
    s = run([select(group)], s).state;
  }
  throw new Error(`could not type ${symbol}`);
}

describe('happy path', () => {
  it('goes listening -> suggesting -> selectReply -> confirmTone -> speaking -> feedback -> listening', () => {
    const start = run([{ type: 'partner_final', text: 'How are you?' }]);
    expect(start.state.phase).toBe('suggesting');
    expect(start.effects).toEqual([
      { type: 'suggest', requestId: 1, partnerText: 'How are you?', mood: null },
    ]);

    let s = atSelectReply();
    expect(s.phase).toBe('selectReply');

    s = run([select(0)], s).state;
    expect(s.phase).toBe('confirmTone');
    expect(s.tone).toBe('happy'); // no mood, no detection -> the AI's tone

    const spoke = run([eye({ type: 'confirm' })], s);
    expect(spoke.state.phase).toBe('speaking');
    expect(spoke.effects).toEqual([
      { type: 'speak', spoken: { id: 'utt-1', text: 'reply 1', tone: 'happy' } },
    ]);

    const done = run([{ type: 'speak_done' }, eye({ type: 'confirm' })], spoke.state);
    expect(done.state.phase).toBe('listening');
    expect(done.effects).toEqual([
      { type: 'user_feedback', spoken: { id: 'utt-1', text: 'reply 1', tone: 'happy' }, ok: true },
    ]);
  });
});

describe('never speaks without confirmation', () => {
  const speaks = (effects: Effect[]) => effects.some((e) => e.type === 'speak');

  it('selecting a reply, a phrase or typed text does not speak', () => {
    expect(speaks(run([select(0)], atSelectReply()).effects)).toBe(false);

    const phrases = choose(initialState(), 'Quick phrases');
    expect(speaks(run([select(0)], phrases).effects)).toBe(false);
  });

  it('choosing a different tone returns to confirmTone instead of speaking', () => {
    let s = run([select(0)], atSelectReply()).state; // confirmTone
    s = run([eye({ type: 'cancel' })], s).state;
    expect(s.phase).toBe('pickTone');
    const r = run([select(0)], s);
    expect(r.state.phase).toBe('confirmTone');
    expect(speaks(r.effects)).toBe(false);
  });

  it('confirm/cancel elsewhere never speaks', () => {
    const r = run([eye({ type: 'confirm' })], atSelectReply());
    expect(r.state.phase).toBe('selectReply');
    expect(r.effects).toEqual([]);
  });
});

describe('at most 4 options on every screen', () => {
  it('holds for every phase, including long lists', () => {
    const many = Array.from({ length: 12 }, (_, i) => `phrase ${i}`);
    let s = { ...atSelectReply(), phrases: many };
    const phases: State[] = [initialState(), s];
    phases.push(choose(s, 'More…')); // menu
    phases.push(choose(choose(s, 'More…'), 'Quick phrases')); // phrases (12 of them)
    phases.push(choose(choose(s, 'More…'), 'Set mood'));
    phases.push(choose(choose(s, 'More…'), 'Type my own reply'));
    s = run([select(0)], s).state; // confirmTone
    phases.push(s, run([eye({ type: 'cancel' })], s).state); // pickTone
    for (const state of phases) {
      const n = getOptions(state).length;
      expect(n, state.phase).toBeLessThanOrEqual(4);
    }
  });

  it('paged(): short lists as they are, long lists 3 per page plus More', () => {
    expect(paged([1, 2, 3, 4], 0)).toEqual({ shown: [1, 2, 3, 4], more: false });
    expect(paged([1, 2, 3, 4, 5, 6, 7], 0)).toEqual({ shown: [1, 2, 3], more: true });
    expect(paged([1, 2, 3, 4, 5, 6, 7], 1)).toEqual({ shown: [4, 5, 6], more: true });
    expect(paged([1, 2, 3, 4, 5, 6, 7], 2)).toEqual({ shown: [7], more: true });
    expect(paged([1, 2, 3, 4, 5, 6, 7], 3)).toEqual({ shown: [1, 2, 3], more: true }); // wraps
  });
});

describe('tone choice', () => {
  const detected = (emotion: 'sad', confidence: number) => ({ emotion, confidence });
  it('mood beats detection beats the AI suggestion', () => {
    expect(chooseTone('joking', detected('sad', 0.9), 'happy')).toBe('joking');
    expect(chooseTone(null, detected('sad', 0.9), 'happy')).toBe('sad');
    expect(chooseTone(null, detected('sad', 0.2), 'happy')).toBe('happy');
  });

  it('pickTone lists every other tone across pages (6 tones -> 5 others)', () => {
    let s = run([select(0)], atSelectReply()).state;
    s = run([eye({ type: 'cancel' })], s).state;
    const seen = new Set(labels(s).filter((l) => (EMOTIONS as readonly string[]).includes(l)));
    expect(labels(s)).toContain('More tones →');
    s = choose(s, 'More tones →');
    labels(s).forEach((l) => (EMOTIONS as readonly string[]).includes(l) && seen.add(l));
    expect(seen.size).toBe(EMOTIONS.length - 1);
    expect(seen.has(s.tone!)).toBe(false); // the current tone is not offered
  });
});

describe('quick phrases, "More…" and mood', () => {
  it('while listening the user can start: phrases, keyboard, mood', () => {
    expect(labels(initialState())).toEqual(['Quick phrases', 'Type my own reply', 'Set mood']);
  });

  it('a quick phrase goes to tone confirmation with the neutral tone', () => {
    let s = choose(initialState(), 'Quick phrases');
    expect(s.phase).toBe('phrases');
    s = choose(s, 'I need help');
    expect(s.phase).toBe('confirmTone');
    expect(s.reply?.text).toBe('I need help');
    expect(s.tone).toBe('neutral');
  });

  it('a long phrase list is paged', () => {
    const s0 = { ...initialState(), phrases: Array.from({ length: 8 }, (_, i) => `p${i}`) };
    let s = choose(s0, 'Quick phrases');
    expect(labels(s)).toEqual(['p0', 'p1', 'p2', 'More phrases →']);
    s = choose(s, 'More phrases →');
    expect(labels(s)).toEqual(['p3', 'p4', 'p5', 'More phrases →']);
  });

  it('"More…" on the reply screen opens the menu, and back returns to the replies', () => {
    let s = choose(atSelectReply(), 'More…');
    expect(s.phase).toBe('menu');
    expect(labels(s)).toEqual(['Quick phrases', 'Type my own reply', 'Set mood', '← Back']);
    s = run([eye({ type: 'cancel' })], s).state;
    expect(s.phase).toBe('selectReply');
  });

  it('back from phrases returns to where you came from', () => {
    let s = choose(choose(atSelectReply(), 'More…'), 'Quick phrases');
    s = run([eye({ type: 'cancel' })], s).state;
    expect(s.phase).toBe('menu');
    s = run([eye({ type: 'cancel' })], s).state;
    expect(s.phase).toBe('selectReply');
  });

  it('choosing a mood saves it and returns; the next tone proposal uses it', () => {
    let r = run([select(2)], initialState()); // "Set mood"
    expect(r.state.phase).toBe('pickMood');
    r = run([select(2)], r.state); // [No mood, neutral, happy, More] -> happy
    expect(r.state.mood).toBe('happy');
    expect(r.state.phase).toBe('listening');
    expect(r.effects).toEqual([{ type: 'save_mood', mood: 'happy' }]);

    const s = run(
      [
        { type: 'partner_final', text: 'hi' },
        { type: 'suggestions_ready', requestId: 1, suggestions: [sug(1, 'sad')] },
      ],
      r.state,
    ).state;
    expect(run([select(0)], s).state.tone).toBe('happy'); // mood beats the AI's "sad"
  });

  it('the mood list can clear the mood and reach every mood through pages', () => {
    let s = choose(initialState(), 'Set mood');
    const seen = new Set(labels(s));
    s = choose(s, 'More moods →');
    labels(s).forEach((l) => seen.add(l));
    s = choose(s, 'More moods →');
    labels(s).forEach((l) => seen.add(l));
    for (const e of EMOTIONS) expect(seen.has(e)).toBe(true);
    expect([...seen].some((l) => l.startsWith('No mood'))).toBe(true);
  });
});

describe('eye keyboard', () => {
  it('types a reply letter by letter and sends it to tone confirmation', () => {
    let s = choose(initialState(), 'Type my own reply');
    expect(s.phase).toBe('typing');
    for (const ch of ['H', 'I']) s = typeSymbol(s, ch);
    expect(s.typed).toBe('Hi');
    s = typeSymbol(s, DONE);
    expect(s.phase).toBe('confirmTone');
    expect(s.reply?.text).toBe('Hi');
  });

  it('every keyboard screen has at most 4 options', () => {
    const s = choose(initialState(), 'Type my own reply');
    expect(getOptions(s).length).toBeLessThanOrEqual(4);
  });

  it('cancel backs out of a group first, then leaves the keyboard', () => {
    let s = choose(initialState(), 'Type my own reply');
    s = run([select(0)], s).state; // into the first group
    expect(s.kbPath).toEqual([0]);
    s = run([eye({ type: 'cancel' })], s).state;
    expect(s.kbPath).toEqual([]);
    expect(s.phase).toBe('typing');
    s = run([eye({ type: 'cancel' })], s).state;
    expect(s.phase).toBe('listening');
    expect(s.typed).toBe('');
  });

  it('"done" with nothing typed does nothing', () => {
    let s = choose(initialState(), 'Type my own reply');
    s = typeSymbol(s, DONE);
    expect(s.phase).toBe('typing');
  });

  it('a caregiver can type the reply in the text box instead', () => {
    let s = choose(initialState(), 'Type my own reply');
    s = run([{ type: 'custom_reply', text: '  Thirsty ' }], s).state;
    expect(s.phase).toBe('confirmTone');
    expect(s.reply?.text).toBe('Thirsty');
    void SPACE;
  });
});

describe('robustness', () => {
  it('ignores stale suggestion responses', () => {
    const r = run([
      { type: 'partner_final', text: 'first' },
      { type: 'partner_final', text: 'second' },
      { type: 'suggestions_ready', requestId: 1, suggestions: [sug(1)] }, // old request
    ]);
    expect(r.state.phase).toBe('suggesting');
    expect(r.state.partnerText).toBe('second');
  });

  it('ignores partner speech while speaking', () => {
    let s = run([select(0), eye({ type: 'confirm' })], atSelectReply()).state;
    expect(s.phase).toBe('speaking');
    s = run([{ type: 'partner_final', text: 'echo of our own voice' }], s).state;
    expect(s.phase).toBe('speaking');
  });

  it('a failed AI call returns to listening with an error', () => {
    const s = run([
      { type: 'partner_final', text: 'hi' },
      { type: 'suggestions_failed', requestId: 1, message: 'boom' },
    ]).state;
    expect(s.phase).toBe('listening');
    expect(s.error).toBe('boom');
  });

  it('keeps every distinct error without repeats', () => {
    const s = run([
      { type: 'error', message: 'Camera denied' },
      { type: 'error', message: 'Mic denied' },
      { type: 'error', message: 'Camera denied' },
    ]).state;
    expect(s.error).toBe('Camera denied · Mic denied');
    expect(run([{ type: 'dismiss_error' }], s).state.error).toBeNull();
  });

  it('cancel while speaking asks to stop', () => {
    const speaking = run([select(0), eye({ type: 'confirm' })], atSelectReply()).state;
    expect(run([eye({ type: 'cancel' })], speaking).effects).toEqual([{ type: 'stop_speaking' }]);
  });

  it('cancel on the feedback screen means "no, the tone was off"', () => {
    const fb = run(
      [select(0), eye({ type: 'confirm' }), { type: 'speak_done' }],
      atSelectReply(),
    ).state;
    const r = run([eye({ type: 'cancel' })], fb);
    expect(r.effects).toEqual([{ type: 'user_feedback', spoken: fb.lastSpoken, ok: false }]);
  });

  it('partner reaction is forwarded for the last spoken reply', () => {
    const spoken = run(
      [select(0), eye({ type: 'confirm' }), { type: 'speak_done' }],
      atSelectReply(),
    ).state;
    const r = run([{ type: 'partner_reaction', reaction: 'seemed_off' }], spoken);
    expect(r.effects).toEqual([
      { type: 'partner_feedback', spoken: spoken.lastSpoken, reaction: 'seemed_off' },
    ]);
    expect(run([{ type: 'partner_reaction', reaction: 'understood' }]).effects).toEqual([]);
  });

  it('new phrases from the profile replace the list', () => {
    const s = run([{ type: 'set_phrases', phrases: ['Hello'] }]).state;
    expect(choose(choose(s, 'Quick phrases'), 'Hello').reply?.text).toBe('Hello');
  });
});
