import { describe, expect, it } from 'vitest';
import type { EmotionEstimate } from '../contracts';
import { summarizeReaction } from './reaction';

const r = (emotion: EmotionEstimate['emotion'], confidence: number): EmotionEstimate => ({
  emotion,
  confidence,
});

describe('summarizeReaction', () => {
  it('reports the expression that lasted and each emotion’s share of the window', () => {
    const out = summarizeReaction([
      r('neutral', 0.9),
      r('happy', 0.6),
      r('happy', 0.8),
      r('sad', 0.3), // too unsure to count
    ]);
    expect(out.emotion).toBe('happy');
    expect(out.face).toEqual({
      scores: { neutral: 0.23, happy: 0.35 },
      peak: 'happy',
      confidence: 0.7,
    });
  });

  it('one stray confident reading in a neutral face is not a reaction', () => {
    const readings = [...Array(12).fill(r('neutral', 0.9)), r('joking', 0.95)];
    const out = summarizeReaction(readings);
    expect(out.emotion).toBeNull();
    expect(out.face.peak).toBeNull();
    expect(out.face.scores.joking).toBeGreaterThan(0); // still visible to Claude, as a small share
  });

  it('an expression that holds for a third of the window counts', () => {
    const readings = [...Array(8).fill(r('neutral', 0.9)), ...Array(5).fill(r('joking', 0.7))];
    expect(summarizeReaction(readings).emotion).toBe('joking');
  });

  it('a calm face has no peak', () => {
    expect(summarizeReaction([r('neutral', 0.9)]).emotion).toBeNull();
    expect(summarizeReaction([]).face).toEqual({ scores: {}, peak: null, confidence: 0 });
  });
});
