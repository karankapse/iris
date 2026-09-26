import { describe, expect, it } from 'vitest';
import type { Suggestion } from '../contracts';
import {
  chooseTone,
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
  it('selecting a reply does not speak', () => {
    const { effects } = run([select(0)], atSelectReply());
    expect(effects.some((e) => e.type === 'speak')).toBe(false);
  });

  it('choosing a different tone returns to confirmTone instead of speaking', () => {
    let s = run([select(0)], atSelectReply()).state; // confirmTone, tone=happy
    s = run([eye({ type: 'cancel' })], s).state;
    expect(s.phase).toBe('pickTone');
    const r = run([select(0)], s); // first "other" tone
    expect(r.state.phase).toBe('confirmTone');
    expect(r.effects.some((e) => e.type === 'speak')).toBe(false);
  });

  it('confirm/cancel in listening or selectReply never speaks', () => {
    const r = run([eye({ type: 'confirm' })], atSelectReply());
    expect(r.state.phase).toBe('selectReply');
    expect(r.effects).toEqual([]);
  });
});

describe('tone choice', () => {
  const detected = (emotion: 'sad', confidence: number) => ({ emotion, confidence });
  it('mood beats detection beats the AI suggestion', () => {
    expect(chooseTone('joking', detected('sad', 0.9), 'happy')).toBe('joking');
    expect(chooseTone(null, detected('sad', 0.9), 'happy')).toBe('sad');
    expect(chooseTone(null, detected('sad', 0.2), 'happy')).toBe('happy');
  });

  it('pickTone offers the 4 tones other than the current one', () => {
    let s = run([select(0)], atSelectReply()).state;
    s = run([eye({ type: 'cancel' })], s).state;
    expect(getOptions(s).map((o) => o.label)).not.toContain(s.tone);
    expect(getOptions(s)).toHaveLength(4);
  });
});

describe('options', () => {
  it('shows at most 4 options: 3 suggestions + "Type my own reply"', () => {
    const s = run(
      [
        { type: 'partner_final', text: 'hi' },
        { type: 'suggestions_ready', requestId: 1, suggestions: [sug(1), sug(2), sug(3), sug(4)] },
      ],
      initialState(),
    ).state;
    const opts = getOptions(s);
    expect(opts).toHaveLength(4);
    expect(opts[3].label).toBe('Type my own reply');
  });

  it('custom reply goes through tone confirmation too', () => {
    let s = run([select(3)], atSelectReply()).state; // 3 suggestions -> index 3 = "type my own"
    expect(s.phase).toBe('typing');
    s = run([{ type: 'custom_reply', text: 'Thirsty' }], s).state;
    expect(s.phase).toBe('confirmTone');
    expect(s.reply?.text).toBe('Thirsty');
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

  it('keeps every distinct error (camera and mic can fail together) without repeats', () => {
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
    // ...and does nothing if nothing has been spoken yet
    expect(run([{ type: 'partner_reaction', reaction: 'understood' }]).effects).toEqual([]);
  });
});
