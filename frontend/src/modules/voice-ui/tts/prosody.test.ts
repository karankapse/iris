import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMOTIONS } from '../../../contracts';
import { BrowserTts } from './BrowserTts';
import { EMOTION_PROFILES } from './emotionProfiles';
import { planSpeech, splitPhrases, splitSentences } from './prosody';
import { pickVoice } from './voices';

const P = EMOTION_PROFILES;

describe('tone range', () => {
  it('spreads pitch over 0.6-1.7 and rate over 0.8-1.3 across the tones', () => {
    const pitches = EMOTIONS.map((e) => P[e].pitch);
    const rates = EMOTIONS.map((e) => P[e].rate);
    expect(Math.min(...pitches)).toBeCloseTo(0.6);
    expect(Math.max(...pitches)).toBeCloseTo(1.7);
    expect(Math.min(...rates)).toBeCloseTo(0.8);
    expect(Math.max(...rates)).toBeCloseTo(1.3);
  });

  it('makes warm (happy) slower and more melodic than cold/flat (serious)', () => {
    expect(P.happy.rate).toBeLessThan(P.serious.rate);
    expect(P.happy.pitchVariation).toBeGreaterThan(P.serious.pitchVariation * 5);
  });
});

describe('splitting', () => {
  it('splits sentences and keeps their punctuation', () => {
    expect(splitSentences('Hi there. How are you? Great!')).toEqual([
      'Hi there.',
      'How are you?',
      'Great!',
    ]);
  });

  it('splits phrases at commas and breaks long runs of words', () => {
    expect(splitPhrases('Yes, I would love that', 8).map((p) => p.text)).toEqual([
      'Yes,',
      'I would love that',
    ]);
    const long = splitPhrases('one two three four five six seven eight nine ten', 6);
    expect(long.map((p) => p.text)).toEqual([
      'one two three four five',
      'six seven eight nine ten',
    ]);
    expect(long[0].soft).toBe(true); // a breath, not a comma pause
  });
});

describe('planSpeech', () => {
  it('rises at the end of a question and falls at the end of a statement', () => {
    const q = planSpeech('Do you want to go outside?', P.neutral);
    const s = planSpeech('I want to go outside.', P.neutral);
    expect(q.at(-1)!.pitch).toBeGreaterThan(P.neutral.pitch);
    expect(s.at(-1)!.pitch).toBeLessThan(P.neutral.pitch);
    expect(q.at(-1)!.text).toBe('go outside?');
  });

  it('puts a longer pause before the final word for emphasis', () => {
    const plan = planSpeech('I am so glad you came today.', P.happy);
    expect(plan.at(-1)!.text).toBe('today.');
    expect(plan.at(-2)!.gapAfterMs).toBe(P.happy.emphasisGapMs);
    expect(plan.at(-1)!.gapAfterMs).toBe(0); // nothing after the reply
  });

  it('pauses between phrases and sentences', () => {
    const plan = planSpeech('Yes, of course. See you soon.', P.sad);
    const gaps = plan.map((c) => c.gapAfterMs);
    expect(gaps).toContain(P.sad.phraseGapMs);
    expect(gaps).toContain(P.sad.sentenceGapMs);
  });

  it('keeps cold/flat nearly monotone and warm varied', () => {
    const text = 'Well, I think that sounds like a good plan for the afternoon.';
    const spread = (e: 'serious' | 'happy') => {
      const p = planSpeech(text, P[e])
        .slice(0, -1)
        .map((c) => c.pitch); // ignore the final fall
      return Math.max(...p) - Math.min(...p);
    };
    expect(spread('serious')).toBeLessThan(0.05);
    expect(spread('happy')).toBeGreaterThan(0.3);
  });

  it("scales rate and pauses by the user's speed, within speechSynthesis limits", () => {
    const slow = planSpeech('Yes, please.', P.neutral, 0.5);
    const fast = planSpeech('Yes, please.', P.neutral, 2);
    expect(slow[0].rate).toBeCloseTo(P.neutral.rate * 0.5);
    expect(slow[0].gapAfterMs).toBe(fast[0].gapAfterMs * 4);
    for (const c of planSpeech('Wow, that is amazing news?', P.excited)) {
      expect(c.pitch).toBeLessThanOrEqual(2);
    }
  });

  it('speaks short replies in one piece and handles empty text', () => {
    expect(planSpeech('Yes.', P.neutral)).toHaveLength(1);
    expect(planSpeech('   ', P.neutral)).toEqual([]);
  });
});

describe('pickVoice', () => {
  const v = (name: string, lang = 'en-US', localService = true) => ({
    name,
    lang,
    localService,
    default: false,
  });

  it('prefers enhanced/premium Ava or Samantha', () => {
    const voices = [
      v('Alex'),
      v('Samantha'),
      v('Ava (Premium)'),
      v('Google US English', 'en-US', false),
    ];
    expect(pickVoice(voices)?.name).toBe('Ava (Premium)');
    expect(pickVoice([v('Samantha'), v('Samantha (Enhanced)')])?.name).toBe('Samantha (Enhanced)');
  });

  it('falls back to plain Samantha, then any en-US, then anything', () => {
    expect(pickVoice([v('Alex'), v('Samantha')])?.name).toBe('Samantha');
    expect(pickVoice([v('Thomas', 'fr-FR'), v('Fred')])?.name).toBe('Fred');
    expect(pickVoice([v('Thomas', 'fr-FR')])?.name).toBe('Thomas');
    expect(pickVoice([])).toBeNull();
  });
});

/** Just enough of speechSynthesis to record what gets spoken. */
function fakeSynth() {
  const spoken: { text: string; pitch: number; rate: number; voice: unknown }[] = [];
  let listeners: (() => void)[] = [];
  let voices: { name: string; lang: string; localService: boolean; default: boolean }[] = [];
  const synth = {
    getVoices: () => voices,
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    removeEventListener: (_: string, fn: () => void) =>
      (listeners = listeners.filter((l) => l !== fn)),
    cancel: vi.fn(),
    speak: (u: {
      text: string;
      pitch: number;
      rate: number;
      voice: unknown;
      onend: () => void;
    }) => {
      spoken.push({ text: u.text, pitch: u.pitch, rate: u.rate, voice: u.voice });
      setTimeout(() => u.onend(), 10);
    },
    loadVoices(v: typeof voices) {
      voices = v;
      listeners.forEach((l) => l());
    },
  };
  class Utterance {
    voice: unknown = null;
    lang = '';
    rate = 1;
    pitch = 1;
    volume = 1;
    onend = () => {};
    onerror = () => {};
    constructor(public text: string) {}
  }
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  return { synth, spoken };
}

describe('BrowserTts', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits for voices to load, then speaks the reply chunk by chunk with the chosen voice', async () => {
    vi.useFakeTimers();
    const { synth, spoken } = fakeSynth();
    const tts = new BrowserTts();
    const done = tts.speak('Yes, I would love to go outside.', 'happy');
    synth.loadVoices([{ name: 'Samantha', lang: 'en-US', localService: true, default: true }]);
    await vi.runAllTimersAsync();
    await done;
    expect(spoken.length).toBeGreaterThan(1);
    expect(spoken.map((s) => s.text).join(' ')).toBe('Yes, I would love to go outside.');
    expect(spoken.every((s) => (s.voice as { name: string })?.name === 'Samantha')).toBe(true);
  });

  it('cancel() stops the rest of the reply', async () => {
    vi.useFakeTimers();
    const { synth, spoken } = fakeSynth();
    synth.loadVoices([{ name: 'Samantha', lang: 'en-US', localService: true, default: true }]);
    const tts = new BrowserTts();
    const done = tts.speak('One, two, three, four, five, six.', 'sad');
    await vi.advanceTimersByTimeAsync(15);
    tts.cancel();
    await vi.runAllTimersAsync();
    await done;
    expect(spoken.length).toBeLessThan(6);
  });
});
