import { describe, expect, it } from 'vitest';
import { EMOTIONS } from '../../../contracts';
import { EMOTION_PROFILES } from './emotionProfiles';

describe('EMOTION_PROFILES', () => {
  it('has a profile for every emotion, within speechSynthesis limits', () => {
    for (const e of EMOTIONS) {
      const p = EMOTION_PROFILES[e];
      expect(p.rate).toBeGreaterThan(0.1);
      expect(p.rate).toBeLessThanOrEqual(10);
      expect(p.pitch).toBeGreaterThanOrEqual(0);
      expect(p.pitch).toBeLessThanOrEqual(2);
      expect(p.volume).toBeGreaterThanOrEqual(0);
      expect(p.volume).toBeLessThanOrEqual(1);
    }
  });

  it('makes sad slower and lower than happy', () => {
    expect(EMOTION_PROFILES.sad.rate).toBeLessThan(EMOTION_PROFILES.happy.rate);
    expect(EMOTION_PROFILES.sad.pitch).toBeLessThan(EMOTION_PROFILES.happy.pitch);
  });

  it('creates ClonedTts or SilentTts via factory', async () => {
    const { createTts, ClonedTts, SilentTts } = await import('./index');
    expect(createTts('silent')).toBeInstanceOf(SilentTts);
    expect(createTts('cloned')).toBeInstanceOf(ClonedTts);
  });
});
