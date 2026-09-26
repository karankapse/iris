import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transcript } from '../../../contracts';
import { TurnDetector, isMeaningful } from './turnDetector';
import { WebSpeechToText } from './WebSpeechToText';

const OPTIONS = { settleMs: 1000, maxTurnMs: 5000 };

function detector() {
  const partials: string[] = [];
  const turns: { text: string; pending: boolean }[] = [];
  const d = new TurnDetector(
    (text) => partials.push(text),
    (text, pending) => turns.push({ text, pending }),
    OPTIONS,
  );
  return { d, partials, turns };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('TurnDetector (grouping speech into whole turns)', () => {
  it('joins pieces split by short pauses into one turn', () => {
    const { d, partials, turns } = detector();
    d.setInterim('do you');
    d.addFinal('Do you want');
    vi.advanceTimersByTime(600); // a short pause, not the end of the turn
    d.setInterim('to go');
    d.addFinal('to go outside?');
    expect(turns).toEqual([]);
    expect(partials.at(-1)).toBe('Do you want to go outside?');

    vi.advanceTimersByTime(1000);
    expect(turns).toEqual([{ text: 'Do you want to go outside?', pending: false }]);
  });

  it('ends a turn the recognizer never finalizes, once the text stops changing', () => {
    const { d, turns } = detector();
    d.setInterim('are you');
    d.setInterim('are you hungry');
    vi.advanceTimersByTime(999);
    d.setInterim('are you hungry'); // identical repeat: doesn't hold the turn open
    vi.advanceTimersByTime(1);
    expect(turns).toEqual([{ text: 'are you hungry', pending: true }]);
  });

  it('ends a turn that never settles (constant background noise) after maxTurnMs', () => {
    const { d, turns } = detector();
    for (let i = 0; i < 12; i++) {
      d.setInterim(`noise ${i}`);
      vi.advanceTimersByTime(500);
    }
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toMatch(/^noise \d+$/);
  });

  it('ignores turns that are only filler sounds', () => {
    const { d, turns } = detector();
    d.addFinal('um');
    d.addFinal('Hmm...');
    vi.advanceTimersByTime(1000);
    expect(turns).toEqual([]);
  });

  it('reset drops the current turn', () => {
    const { d, turns } = detector();
    d.addFinal('hello there');
    d.reset();
    vi.advanceTimersByTime(10_000);
    expect(turns).toEqual([]);
  });

  it('isMeaningful keeps short real words like "Water?"', () => {
    expect(isMeaningful('Water?')).toBe(true);
    expect(isMeaningful('uh, um')).toBe(false);
    expect(isMeaningful('')).toBe(false);
  });
});

/** Just enough of Chrome's SpeechRecognition to drive WebSpeechToText. */
class FakeRecognition {
  static last: FakeRecognition;
  continuous = false;
  interimResults = false;
  lang = '';
  onstart: (() => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  aborted = 0;
  private results: { isFinal: boolean; 0: { transcript: string } }[] = [];
  constructor() {
    FakeRecognition.last = this;
  }
  start() {}
  stop() {}
  abort() {
    this.aborted++;
  }
  /** Replace the latest interim result (or add one), like Chrome does while you talk. */
  say(text: string, isFinal = false) {
    const lastIsInterim = this.results.length > 0 && !this.results.at(-1)!.isFinal;
    const index = lastIsInterim ? this.results.length - 1 : this.results.length;
    this.results[index] = { isFinal, 0: { transcript: text } };
    this.onresult?.({ resultIndex: index, results: this.results });
  }
}

describe('WebSpeechToText with turn detection', () => {
  beforeEach(() => {
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition =
      FakeRecognition;
  });

  function start() {
    const stt = new WebSpeechToText();
    const got: Transcript[] = [];
    stt.onTranscript((t) => got.push(t));
    stt.start();
    return { stt, got, rec: FakeRecognition.last };
  }

  it('sends one final transcript per turn, with the whole sentence', () => {
    const { got, rec } = start();
    rec.say('do you want');
    rec.say('Do you want', true);
    rec.say('to go outside');
    rec.say('to go outside?', true);
    vi.advanceTimersByTime(1200);

    const finals = got.filter((t) => t.isFinal).map((t) => t.text);
    expect(finals).toEqual(['Do you want to go outside?']);
    expect(got.at(-2)).toEqual({ text: 'Do you want to go outside?', isFinal: false });
    expect(rec.aborted).toBe(0); // Chrome had finalized everything, nothing to drop
  });

  it("drops Chrome's pending copy when it ends a turn Chrome hadn't finalized", () => {
    const { got, rec } = start();
    rec.say('are you hungry');
    vi.advanceTimersByTime(1200);
    expect(got.filter((t) => t.isFinal).map((t) => t.text)).toEqual(['are you hungry']);
    expect(rec.aborted).toBe(1);
  });

  it('stop() discards a half-finished turn', () => {
    const { stt, got, rec } = start();
    rec.say('are you');
    stt.stop();
    vi.advanceTimersByTime(5000);
    expect(got.some((t) => t.isFinal)).toBe(false);
  });
});
