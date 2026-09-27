import type { Emotion } from '../../../contracts';

export interface VoiceProfile {
  /** 0.1..10, 1 = normal speaking speed. Tones span 0.8..1.3. */
  rate: number;
  /** 0..2, 1 = normal pitch. Tones span 0.6..1.7. */
  pitch: number;
  /** 0..1 */
  volume: number;
  /** How much the pitch moves between phrases (± around `pitch`). 0 = monotone (cold/flat). */
  pitchVariation: number;
  /** Pause after a phrase (comma, clause) and after a sentence, in ms at speed 1. */
  phraseGapMs: number;
  sentenceGapMs: number;
  /** Extra pause right before the very last word, for emphasis (0 = none). */
  emphasisGapMs: number;
  /** End of a statement: pitch drops by this. End of a question: pitch rises by `questionRise`. */
  finalFall: number;
  questionRise: number;
  /** Longer phrases than this (words) are split, so there are breaths in long sentences. */
  maxPhraseWords: number;
}

/**
 * How each emotion shapes the browser's built-in voice. speechSynthesis can't bend pitch inside
 * one utterance, so cadence comes from speaking phrase by phrase: each gets its own pitch and
 * rate, with real pauses between them (see prosody.ts). Tune by ear at /tone-tester.
 *   warm (happy): slower, wide pitch movement, a beat before the last word
 *   cold/flat (serious): faster, almost no pitch movement, short gaps
 */
export const EMOTION_PROFILES: Record<Emotion, VoiceProfile> = {
  neutral: {
    rate: 0.98, // a touch slower, so it contrasts more with happy (Nishanth)
    pitch: 1.0,
    volume: 1.0,
    pitchVariation: 0.06,
    phraseGapMs: 120,
    sentenceGapMs: 300,
    emphasisGapMs: 0,
    finalFall: 0.08,
    questionRise: 0.25,
    maxPhraseWords: 8,
  },
  happy: {
    rate: 0.92,
    pitch: 1.3,
    volume: 1.0,
    pitchVariation: 0.22,
    phraseGapMs: 180,
    sentenceGapMs: 380,
    emphasisGapMs: 220,
    finalFall: 0.1,
    questionRise: 0.3,
    maxPhraseWords: 7,
  },
  sad: {
    rate: 0.8,
    pitch: 0.6,
    volume: 0.75,
    pitchVariation: 0.05,
    phraseGapMs: 320,
    sentenceGapMs: 600,
    emphasisGapMs: 350,
    finalFall: 0.15,
    questionRise: 0.15,
    maxPhraseWords: 6,
  },
  excited: {
    rate: 1.3,
    pitch: 1.7,
    volume: 1.0,
    pitchVariation: 0.25,
    phraseGapMs: 60,
    sentenceGapMs: 180,
    emphasisGapMs: 150,
    finalFall: 0.05,
    questionRise: 0.3,
    maxPhraseWords: 10,
  },
  joking: {
    rate: 1.15,
    pitch: 1.45,
    volume: 1.0,
    pitchVariation: 0.28,
    phraseGapMs: 120,
    sentenceGapMs: 260,
    emphasisGapMs: 400, // comic timing: a beat before the punchline
    finalFall: 0.1,
    questionRise: 0.3,
    maxPhraseWords: 8,
  },
  serious: {
    rate: 1.12,
    pitch: 0.8,
    volume: 1.0,
    pitchVariation: 0.02,
    phraseGapMs: 70,
    sentenceGapMs: 200,
    emphasisGapMs: 0,
    finalFall: 0.12,
    questionRise: 0.1,
    maxPhraseWords: 10,
  },
};
