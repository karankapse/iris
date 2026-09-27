// Turns a reply into a sequence of spoken chunks with their own pitch, rate and pauses, so the
// browser voice gets cadence instead of one flat line. Pure logic, so it can be tested.
import type { VoiceProfile } from './emotionProfiles';

export interface SpeechChunk {
  text: string;
  rate: number;
  pitch: number;
  volume: number;
  /** Silence after this chunk (ms). */
  gapAfterMs: number;
}

/** Sentence tails shorter than this (words) aren't split off: too choppy. */
const MIN_WORDS_FOR_TAIL = 4;
/** Statements slow down a little at the end, like people do. */
const FINAL_LENGTHENING = 0.94;
/** Pause between two halves of a long phrase split without punctuation, relative to phraseGapMs. */
const SOFT_BREAK = 0.4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** "Hi there. How are you?" -> ["Hi there.", "How are you?"] (keeps the end punctuation). */
export function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]*|[.!?]+/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/** Split a sentence at commas/semicolons/dashes, then break phrases longer than `maxWords`. */
export function splitPhrases(
  sentence: string,
  maxWords: number,
): { text: string; soft: boolean }[] {
  const out: { text: string; soft: boolean }[] = [];
  for (const part of sentence.split(/(?<=[,;:])\s+|\s+[-–—]\s+/)) {
    const w = words(part);
    if (!w.length) continue;
    const pieces = Math.ceil(w.length / Math.max(1, maxWords));
    const size = Math.ceil(w.length / pieces);
    for (let i = 0; i < w.length; i += size) {
      out.push({ text: w.slice(i, i + size).join(' '), soft: i + size < w.length });
    }
  }
  return out;
}

/**
 * Plan how to say `text` in the tone described by `profile`.
 *  - one chunk per phrase, pitch drifting down across the sentence (natural declination), by
 *    ±pitchVariation (0 = flat);
 *  - the last one or two words of each sentence are their own chunk: they RISE for a question and
 *    FALL for a statement;
 *  - a longer pause before the final word of the reply, for emphasis;
 *  - pauses after phrases and sentences; `speed` (the user's setting) scales rate and pauses.
 */
export function planSpeech(text: string, profile: VoiceProfile, speed = 1): SpeechChunk[] {
  const chunks: SpeechChunk[] = [];
  const sentences = splitSentences(text);
  const gap = (ms: number) => Math.round(ms / speed);

  sentences.forEach((sentence, si) => {
    const lastSentence = si === sentences.length - 1;
    const question = sentence.endsWith('?');
    const exclaim = sentence.endsWith('!');
    const phrases = splitPhrases(sentence, profile.maxPhraseWords);

    // Split the sentence's tail off the last phrase so the rise/fall is audible.
    const last = phrases.at(-1);
    let tail: string | null = null;
    const emphasis = lastSentence && profile.emphasisGapMs > 0;
    if (last && words(sentence).length >= MIN_WORDS_FOR_TAIL) {
      const w = words(last.text);
      const take = emphasis ? 1 : Math.min(2, w.length - 1);
      if (take > 0 && w.length > take) {
        last.text = w.slice(0, -take).join(' ');
        last.soft = false;
        tail = w.slice(-take).join(' ');
      }
    }

    const n = phrases.length;
    phrases.forEach((p, i) => {
      // declination: start above the base pitch, drift below it by the end of the sentence
      const drift = n > 1 ? 1 - (2 * i) / (n - 1) : 0;
      const isEnd = i === n - 1 && !tail;
      chunks.push({
        text: p.text,
        rate: profile.rate * speed * (isEnd && !question ? FINAL_LENGTHENING : 1),
        pitch: isEnd
          ? endPitch(profile, question, exclaim)
          : profile.pitch + profile.pitchVariation * drift,
        volume: profile.volume,
        gapAfterMs: isEnd
          ? gap(profile.sentenceGapMs)
          : i === n - 1 // followed by the tail
            ? gap(emphasis ? profile.emphasisGapMs : 0)
            : gap(p.soft ? profile.phraseGapMs * SOFT_BREAK : profile.phraseGapMs),
      });
    });
    if (tail) {
      chunks.push({
        text: tail,
        rate: profile.rate * speed * (question ? 1 : FINAL_LENGTHENING),
        pitch: endPitch(profile, question, exclaim),
        volume: profile.volume,
        gapAfterMs: gap(profile.sentenceGapMs),
      });
    }
  });

  if (chunks.length) chunks[chunks.length - 1].gapAfterMs = 0; // nothing after the reply
  return chunks.map((c) => ({
    ...c,
    rate: clamp(c.rate, 0.1, 10),
    pitch: clamp(c.pitch, 0, 2),
    volume: clamp(c.volume, 0, 1),
  }));
}

function endPitch(profile: VoiceProfile, question: boolean, exclaim: boolean): number {
  if (question) return profile.pitch + profile.questionRise;
  if (exclaim) return profile.pitch + profile.pitchVariation * 0.5; // stays up
  return profile.pitch - profile.finalFall;
}
