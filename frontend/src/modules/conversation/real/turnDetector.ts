/**
 * Groups a speech recognizer's fragments into whole turns ("the partner finished speaking").
 *
 * Chrome's recognizer ends a result at every short pause, so one sentence often arrives as
 * several final pieces ("Do you want" + "to go outside?"). In a noisy room it may never
 * finalize at all. This collects the pieces and ends the turn only once the text has stopped
 * changing for `settleMs`, or after `maxTurnMs` if the room never goes quiet.
 */

export interface TurnOptions {
  /** How long the text must stay unchanged before the turn counts as finished. */
  settleMs: number;
  /** Longest a turn can run before it is ended anyway (constant background noise). */
  maxTurnMs: number;
}

export const DEFAULT_TURN_OPTIONS: TurnOptions = { settleMs: 1200, maxTurnMs: 12000 };

/** Sounds that aren't worth asking for reply suggestions on their own. */
const FILLERS = new Set([
  'um',
  'umm',
  'uh',
  'uhm',
  'erm',
  'er',
  'hmm',
  'hm',
  'mm',
  'mhm',
  'ah',
  'eh',
]);

/** True if the text has at least one real word (not just "um", "hmm", ...). */
export function isMeaningful(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.some((w) => !FILLERS.has(w));
}

export class TurnDetector {
  private finals: string[] = [];
  private interim = '';
  private lastText = '';
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    /** The turn so far, for live display. */
    private onPartial: (text: string) => void,
    /** A finished turn. `pending` is true if the recognizer still had unfinalized text. */
    private onTurn: (text: string, pending: boolean) => void,
    private options: TurnOptions = DEFAULT_TURN_OPTIONS,
  ) {}

  /** A piece the recognizer has finalized. */
  addFinal(text: string) {
    const t = text.trim();
    if (t) this.finals.push(t);
    this.interim = '';
    this.changed();
  }

  /** The recognizer's current guess for what is being said now (replaces the previous one). */
  setInterim(text: string) {
    this.interim = text.trim();
    this.changed();
  }

  /**
   * The recognizer's session ended (it restarts itself) while it still had an unfinalized guess:
   * keep that text as part of the turn, because the next session starts from scratch and its
   * first interim result would otherwise replace it.
   */
  keepInterim() {
    if (!this.interim) return;
    this.finals.push(this.interim);
    this.interim = '';
    this.changed(); // same text: the turn's timers are not restarted
  }

  /** End the current turn now. */
  flush() {
    const text = this.text();
    const pending = this.interim !== '';
    this.reset();
    if (isMeaningful(text)) this.onTurn(text, pending);
  }

  /** Drop the current turn without reporting it. */
  reset() {
    this.finals = [];
    this.interim = '';
    this.lastText = '';
    this.clearTimers();
  }

  private text() {
    return [...this.finals, this.interim].filter(Boolean).join(' ');
  }

  private changed() {
    const text = this.text();
    // Repeated identical results don't count as speech, so they don't hold the turn open.
    if (text === this.lastText) return;
    this.lastText = text;
    this.onPartial(text);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.flush(), this.options.settleMs);
    this.maxTimer ??= setTimeout(() => this.flush(), this.options.maxTurnMs);
  }

  private clearTimers() {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.settleTimer = null;
    this.maxTimer = null;
  }
}
