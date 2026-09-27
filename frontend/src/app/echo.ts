// The laptop's microphone hears the laptop's own speakers. Browser echo cancellation only removes
// sound Chrome itself plays, and the browser voice is played by macOS, so the app's own reply can
// come back as "the partner said...". These helpers keep it from being treated as the partner.

/** Ignore the microphone for this long after the app stops speaking (speech engines deliver
 * a finished sentence about a second after it ends; a later echo is still caught by isEchoOf). */
export const ECHO_TAIL_MS = 1000;
/** A "partner" sentence this soon after a reply is checked against the reply's words. */
export const ECHO_WINDOW_MS = 15000;
/** Share of the heard words that also appear in the reply for it to count as our own echo. */
const ECHO_OVERLAP = 0.6;

const words = (text: string) => text.toLowerCase().match(/[a-z0-9']+/g) ?? [];

/** True if `heard` is (mostly) the words of `spoken`, i.e. the app hearing itself. */
export function isEchoOf(heard: string, spoken: string): boolean {
  const h = words(heard);
  if (!h.length) return false;
  const said = new Set(words(spoken));
  const shared = h.filter((w) => said.has(w)).length;
  return shared / h.length >= ECHO_OVERLAP;
}
