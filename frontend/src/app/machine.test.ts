import { describe, expect, it } from 'vitest';
import { EMOTIONS } from '../contracts';
import type { Suggestion } from '../contracts';
import { DONE, SPACE, symbolsAt } from './keyboard';
import {
  chooseTone,
  getEntries,
  getOptions,
  initialState,
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

/** From the reply screen, open "Other…" and page through the menu to `label`. */
function fromMenu(label: string, base?: Partial<State>): State {
  let s = choose({ ...atSelectReply(), ...base }, 'Other…');
  for (let i = 0; i < 4 && !labels(s).includes(label); i++) s = choose(s, 'Other →');
  return choose(s, label);
}

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
  it('goes listening -> suggesting -> selectReply -> speaking -> straight back to listening', () => {
    const start = run([{ type: 'partner_final', text: 'How are you?' }]);
    expect(start.state.phase).toBe('suggesting');
    expect(start.effects).toEqual([
      { type: 'suggest', requestId: 1, partnerText: 'How are you?', mood: null, reaction: null },
    ]);

    const s = atSelectReply();
    expect(s.phase).toBe('selectReply');

    // Selecting a reply immediately speaks in the measured emotion tone without asking
    const spoke = run([select(0)], s);
    expect(spoke.state.phase).toBe('speaking');
    expect(spoke.effects).toEqual([
      { type: 'snapshot_features' },
      { type: 'speak', spoken: { id: 'utt-1', text: 'reply 1', tone: 'happy' } },
    ]);

    const done = run([{ type: 'speak_done' }], spoke.state);
    expect(done.state.phase).toBe('listening'); // no feedback step: the conversation keeps flowing
    expect(done.effects).toEqual([]);
  });

  it('includes live detected facial emotion as reaction when partner speaks', () => {
    const smilingState = {
      ...initialState(),
      detected: { emotion: 'happy' as const, confidence: 0.9 },
    };
    const res = run([{ type: 'partner_final', text: 'you got a job' }], smilingState);
    expect(res.state.phase).toBe('suggesting');
    expect(res.effects).toEqual([
      {
        type: 'suggest',
        requestId: 1,
        partnerText: 'you got a job',
        mood: null,
        reaction: 'happy',
      },
    ]);
  });

  it('speaks in the measured post-statement emotion when reply is selected', () => {
    const state = run(
      [
        { type: 'partner_final', text: 'you got a job' },
        {
          type: 'suggestions_ready',
          requestId: 1,
          suggestions: [sug(1, 'neutral'), sug(2, 'neutral')],
          reaction: 'happy',
        },
      ],
      initialState(),
    ).state;
    expect(state.phase).toBe('selectReply');
    expect(state.measuredEmotion).toBe('happy');

    // Selecting reply 1 speaks directly in the measured happy tone
    const spoke = run([select(0)], state);
    expect(spoke.state.phase).toBe('speaking');
    expect(spoke.effects).toContainEqual({
      type: 'speak',
      spoken: { id: 'utt-1', text: 'reply 1', tone: 'happy' },
    });
  });
});

describe('tone selection and speaking', () => {
  const speaks = (effects: Effect[]) => effects.some((e) => e.type === 'speak');

  it('choosing a different tone in pickTone returns to confirmTone', () => {
    const inConfirm: State = {
      ...initialState(),
      phase: 'confirmTone',
      reply: { text: 'Hi', suggestedTone: 'neutral' },
      tone: 'neutral',
    };
    const s = run([eye({ type: 'cancel' })], inConfirm).state;
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

describe('EXACTLY 3 options on every screen (no blanks), the 3rd is always "Other"-like', () => {
  /** Walk every screen reachable from a start state (breadth-first over all options). */
  function allReachable(start: State, limit = 400): State[] {
    const seen = new Map<string, State>();
    const queue = [start];
    while (queue.length && seen.size < limit) {
      const s = queue.shift()!;
      const key = JSON.stringify([s.phase, s.page, s.kbPath, s.typed.length > 0, s.returnStack]);
      if (seen.has(key)) continue;
      seen.set(key, s);
      getOptions(s).forEach((_, i) => queue.push(run([select(i)], s).state));
    }
    return [...seen.values()];
  }

  it('holds for every reachable screen, with long and short lists', () => {
    const many = Array.from({ length: 12 }, (_, i) => `phrase ${i}`);
    const starts = [
      initialState(),
      { ...initialState(), phrases: many },
      { ...initialState(), phrases: [] },
      atSelectReply(),
      run(
        [
          { type: 'partner_final', text: 'hi there' },
          { type: 'suggestions_ready', requestId: 1, suggestions: [sug(1)] }, // only ONE suggestion
        ],
        { ...initialState(), phrases: [] },
      ).state,
      run([{ type: 'partner_final', text: 'hi there' }]).state, // waiting for the AI
    ];
    for (const start of starts) {
      for (const s of allReachable(start)) {
        const opts = getOptions(s);
        expect(opts, s.phase).toHaveLength(3);
        for (const o of opts) expect(o.label.trim().length, s.phase).toBeGreaterThan(0);
      }
    }
  });

  it('the 3rd option on the main screens is "Other…"', () => {
    expect(labels(atSelectReply())[2]).toBe('Other…');
  });

  it('a long list shows 2 at a time and the 3rd option pages through all of them', () => {
    const s0 = { ...initialState(), phrases: ['a', 'b', 'c', 'd', 'e'] };
    let s = fromMenu('Quick phrases', { phrases: s0.phrases });
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      expect(labels(s)[2]).toBe('Other →');
      labels(s)
        .slice(0, 2)
        .forEach((l) => seen.add(l));
      s = choose(s, 'Other →');
    }
    for (const p of ['a', 'b', 'c', 'd', 'e']) expect(seen.has(p)).toBe(true);
    expect(seen.has('← Back')).toBe(true); // back is reachable in the cycle too
  });

  it('with only one AI suggestion, a quick phrase fills the second slot (no blank)', () => {
    const s = run([
      { type: 'partner_final', text: 'hi there' },
      { type: 'suggestions_ready', requestId: 1, suggestions: [sug(1)] },
    ]).state;
    expect(labels(s)).toEqual(['reply 1', 'I need help', 'Other…']);
  });

  it('while thinking or speaking, the slots hold info cards that cannot be chosen', () => {
    const thinking = run([{ type: 'partner_final', text: 'Hungry?' }]).state;
    expect(getOptions(thinking).every((o) => o.info)).toBe(true);
    expect(run([select(1)], thinking).state.phase).toBe('suggesting'); // nothing happens

    const speaking = run([select(0), eye({ type: 'confirm' })], atSelectReply());
    expect(labels(speaking.state)[0]).toBe('Stop speaking');
    expect(run([select(0)], speaking.state).effects).toEqual([{ type: 'stop_speaking' }]);
  });
});

describe('tone choice', () => {
  const detected = (emotion: 'sad', confidence: number) => ({ emotion, confidence });
  it('mood beats detection beats the AI suggestion', () => {
    expect(chooseTone('joking', detected('sad', 0.9), 'happy')).toBe('joking');
    expect(chooseTone(null, detected('sad', 0.9), 'happy')).toBe('sad');
    expect(chooseTone(null, detected('sad', 0.2), 'happy')).toBe('happy');
  });

  it('pickTone reaches every other tone through the pages (6 tones -> 5 others)', () => {
    const inConfirm: State = {
      ...initialState(),
      phase: 'confirmTone',
      reply: { text: 'reply 1', suggestedTone: 'neutral' },
      tone: 'neutral',
    };
    let s = run([eye({ type: 'cancel' })], inConfirm).state;
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      labels(s).forEach((l) => (EMOTIONS as readonly string[]).includes(l) && seen.add(l));
      s = choose(s, 'Other →');
    }
    expect(seen.size).toBe(EMOTIONS.length - 1);
    expect(seen.has(s.tone!)).toBe(false); // the current tone is not offered
  });
});

describe('quick phrases, "Other…" and mood', () => {
  it('while listening there is nothing to pick by accident: 3 info cards', () => {
    const opts = getOptions(initialState());
    expect(opts).toHaveLength(3);
    expect(opts.every((o) => o.info)).toBe(true);
  });

  it('a quick phrase goes to tone confirmation with the neutral tone', () => {
    let s = fromMenu('Quick phrases');
    expect(s.phase).toBe('phrases');
    s = choose(s, 'I need help');
    expect(s.phase).toBe('confirmTone');
    expect(s.reply?.text).toBe('I need help');
    expect(s.tone).toBe('neutral');
  });

  it('"Other…" on the reply screen opens the menu, and back returns to the replies', () => {
    let s = choose(atSelectReply(), 'Other…');
    expect(s.phase).toBe('menu');
    s = run([eye({ type: 'cancel' })], s).state;
    expect(s.phase).toBe('selectReply');
  });

  it('the 3rd AI suggestion is reachable under Other… → More replies', () => {
    let s = choose(atSelectReply(), 'Other…');
    for (let i = 0; i < 4 && !labels(s).includes('More replies'); i++) s = choose(s, 'Other →');
    s = choose(s, 'More replies');
    expect(labels(s)).toContain('reply 3');
  });

  it('back from phrases returns to where you came from, step by step', () => {
    let s = fromMenu('Quick phrases');
    s = run([eye({ type: 'cancel' })], s).state;
    expect(s.phase).toBe('menu');
    s = run([eye({ type: 'cancel' })], s).state;
    expect(s.phase).toBe('selectReply');
  });

  it('choosing a mood saves it and returns; the next tone proposal uses it', () => {
    let s = fromMenu('Set mood');
    expect(s.phase).toBe('pickMood');
    for (let i = 0; i < 4 && !labels(s).includes('happy'); i++) s = choose(s, 'Other →');
    const r = run([select(labels(s).indexOf('happy'))], s);
    expect(r.state.mood).toBe('happy');
    expect(r.state.phase).toBe('menu');
    expect(r.effects).toEqual([{ type: 'save_mood', mood: 'happy' }]);

    // back out to the listening screen (partner speech is ignored while in menus)
    const listening = run([eye({ type: 'cancel' }), eye({ type: 'cancel' })], r.state).state;
    expect(listening.phase).toBe('listening');
    const next = run(
      [
        { type: 'partner_final', text: 'hi there' },
        // the reply screen we came from was request 1, so this is request 2
        { type: 'suggestions_ready', requestId: 2, suggestions: [sug(1, 'sad')] },
      ],
      listening,
    ).state;
    expect(run([select(0)], next).state.tone).toBe('happy'); // mood beats the AI's "sad"
  });

  it('the mood list reaches every mood and "no mood"', () => {
    let s = fromMenu('Set mood');
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) {
      labels(s).forEach((l) => seen.add(l));
      s = choose(s, 'Other →');
    }
    for (const e of EMOTIONS) expect(seen.has(e)).toBe(true);
    expect([...seen].some((l) => l.startsWith('No mood'))).toBe(true);
  });

  it('on the tone screen, "Other reply…" goes back to choosing a reply without speaking', () => {
    const s: State = {
      ...atSelectReply(),
      phase: 'confirmTone',
      reply: { text: 'reply 1', suggestedTone: 'neutral' },
      tone: 'neutral',
    };
    const r = run([select(2)], s);
    expect(r.state.phase).toBe('selectReply');
    expect(r.effects).toEqual([]);
  });

  it('feedback can be skipped', () => {
    const fb = run(
      [select(0), eye({ type: 'confirm' }), { type: 'speak_done' }],
      atSelectReply(),
    ).state;
    const r = run([select(2)], fb);
    expect(r.state.phase).toBe('listening');
    expect(r.effects).toEqual([]);
  });
});

describe('eye keyboard', () => {
  it('types a reply letter by letter and sends it to tone confirmation', () => {
    let s = fromMenu('Type my own reply');
    expect(s.phase).toBe('typing');
    for (const ch of ['H', 'I']) s = typeSymbol(s, ch);
    expect(s.typed).toBe('Hi');
    s = typeSymbol(s, DONE);
    expect(s.phase).toBe('confirmTone');
    expect(s.reply?.text).toBe('Hi');
  });

  it('every keyboard screen has exactly 3 options', () => {
    const s = fromMenu('Type my own reply');
    expect(getOptions(s)).toHaveLength(3);
  });

  it('cancel backs out of a group first, then leaves the keyboard', () => {
    let s = fromMenu('Type my own reply');
    s = run([select(0)], s).state; // into the first group
    expect(s.kbPath).toEqual([0]);
    s = run([eye({ type: 'cancel' })], s).state;
    expect(s.kbPath).toEqual([]);
    expect(s.phase).toBe('typing');
    s = run([eye({ type: 'cancel' })], s).state;
    expect(s.phase).toBe('menu'); // back to where the keyboard was opened from
    expect(s.typed).toBe('');
  });

  it('"done" with nothing typed does nothing', () => {
    let s = fromMenu('Type my own reply');
    s = typeSymbol(s, DONE);
    expect(s.phase).toBe('typing');
  });

  it('a caregiver can type the reply in the text box instead', () => {
    let s = fromMenu('Type my own reply');
    s = run([{ type: 'custom_reply', text: '  Thirsty ' }], s).state;
    expect(s.phase).toBe('confirmTone');
    expect(s.reply?.text).toBe('Thirsty');
    void SPACE;
  });
});

describe('robustness', () => {
  it('ignores stale suggestion responses', () => {
    const r = run([
      { type: 'partner_final', text: 'first thing' },
      { type: 'partner_final', text: 'second thing' },
      { type: 'suggestions_ready', requestId: 1, suggestions: [sug(1)] }, // old request
    ]);
    expect(r.state.phase).toBe('suggesting');
    expect(r.state.partnerText).toBe('second thing');
  });

  it('ignores partner speech while speaking', () => {
    let s = run([select(0), eye({ type: 'confirm' })], atSelectReply()).state;
    expect(s.phase).toBe('speaking');
    s = run([{ type: 'partner_final', text: 'echo of our own voice' }], s).state;
    expect(s.phase).toBe('speaking');
  });

  it('a failed AI call returns to listening with an error', () => {
    const s = run([
      { type: 'partner_final', text: 'hi there' },
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
    expect(choose(fromMenu('Quick phrases', { phrases: s.phrases }), 'Hello').reply?.text).toBe(
      'Hello',
    );
  });
});

describe('partner speech is only taken in when it makes sense', () => {
  it('ignores lone filler words, but not a one-word question', () => {
    expect(run([{ type: 'partner_final', text: 'Yeah,' }]).state.phase).toBe('listening');
    expect(run([{ type: 'partner_final', text: 'um' }]).state.phase).toBe('listening');
    expect(run([{ type: 'partner_final', text: 'Hungry?' }]).state.phase).toBe('suggesting');
    expect(run([{ type: 'partner_final', text: 'Are you hungry' }]).state.phase).toBe('suggesting');
  });

  it('does not replace the replies while the user is choosing', () => {
    const s = atSelectReply();
    const r = run([{ type: 'partner_final', text: 'something in the background' }], s);
    expect(r.state.phase).toBe('selectReply');
    expect(r.state.suggestions).toEqual(s.suggestions);
    expect(r.effects).toEqual([]);
  });
});

describe('speech heard while choosing is held, not lost', () => {
  it('is shown as "Also said" and answered right after the reply is spoken', () => {
    let s = atSelectReply();
    const choices = labels(s);
    s = run([{ type: 'partner_final', text: 'Or are you thirsty?' }], s).state;
    expect(s.phase).toBe('selectReply'); // the replies stay put
    expect(labels(s)).toEqual(choices);
    expect(s.heldPartner).toBe('Or are you thirsty?');

    s = run([select(0), eye({ type: 'confirm' })], s).state; // speak a reply
    const r = run([{ type: 'speak_done' }], s);
    expect(r.state.phase).toBe('suggesting'); // back to listening, then straight to the held question
    expect(r.state.partnerText).toBe('Or are you thirsty?');
    expect(r.state.heldPartner).toBe('');
    expect(r.effects).toContainEqual(
      expect.objectContaining({ type: 'suggest', partnerText: 'Or are you thirsty?' }),
    );
  });

  it('filler words are not held', () => {
    const s = run([{ type: 'partner_final', text: 'um' }], atSelectReply()).state;
    expect(s.heldPartner).toBe('');
  });

  it('nothing is held while Iris is speaking (it would hear itself)', () => {
    const speaking = run([select(0), eye({ type: 'confirm' })], atSelectReply()).state;
    expect(speaking.phase).toBe('speaking');
    expect(run([{ type: 'partner_final', text: 'hello there' }], speaking).state.heldPartner).toBe(
      '',
    );
  });

  it('keeps only the most recent words', () => {
    let s = atSelectReply();
    for (let i = 1; i <= 15; i++)
      s = run([{ type: 'partner_final', text: `w${i} x${i}` }], s).state;
    expect(s.heldPartner.split(' ')).toHaveLength(21); // "…" + the last 20 words
    expect(s.heldPartner.endsWith(' w15 x15')).toBe(true);
  });
});
