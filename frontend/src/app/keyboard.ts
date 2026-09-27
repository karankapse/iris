// A simple eye-controlled keyboard. Like every screen in Iris it shows EXACTLY 3 options.
//
// 29 symbols (A-Z, space, delete, done) are split into groups of three at each step:
//   screen 1: 3 groups of ~10 symbols  -> pick one
//   screen 2: 3 groups of ~4 symbols   -> pick one
//   screen 3: 2 groups of ~2 symbols   -> pick one
//   screen 4: the 2 symbols themselves -> pick one
// That is 4 selections per symbol. It is slow but works with big targets and very coarse gaze.
// A screen with fewer than 3 real choices is filled up with "← Back" (never a blank slot).
// (A later improvement: word prediction as one of the options.)
import { MAX_OPTIONS } from '../core/config';

export const SPACE = ' ';
export const DELETE = '⌫';
export const DONE = '✓';

export const LETTERS: string[] = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
export const SYMBOLS: string[] = [...LETTERS, SPACE, DELETE, DONE];

/** Split a list into at most `parts` near-equal consecutive chunks. */
export function chunk<T>(items: T[], parts = MAX_OPTIONS): T[][] {
  const size = Math.ceil(items.length / parts);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The symbols still reachable after following `path` (each step = which group was chosen). */
export function symbolsAt(path: number[], all: string[] = SYMBOLS): string[] {
  let symbols = all;
  for (const index of path) {
    const groups = symbols.length <= MAX_OPTIONS ? symbols.map((s) => [s]) : chunk(symbols);
    symbols = groups[index] ?? symbols;
  }
  return symbols;
}

export type KeyEntry =
  | { kind: 'group'; index: number; label: string }
  | { kind: 'symbol'; symbol: string; label: string }
  | { kind: 'back'; label: string };

const NAME: Record<string, string> = {
  [SPACE]: '␣ space',
  [DELETE]: '⌫ delete',
  [DONE]: '✓ use this reply',
};
const SHORT: Record<string, string> = { [SPACE]: '␣', [DELETE]: '⌫', [DONE]: '✓' };
const BACK: KeyEntry = { kind: 'back', label: '← Back' };

/** What to show for the current position: 3 groups (when there are more than 3 symbols) or the symbols. */
export function keyboardEntries(path: number[], all: string[] = SYMBOLS): KeyEntry[] {
  const symbols = symbolsAt(path, all);
  const entries: KeyEntry[] =
    symbols.length <= MAX_OPTIONS
      ? symbols.map((symbol) => ({ kind: 'symbol', symbol, label: NAME[symbol] ?? symbol }))
      : chunk(symbols).map((group, index) => ({
          kind: 'group',
          index,
          label: group.map((s) => SHORT[s] ?? s).join(' '),
        }));
  // never a blank slot: fill up to 3 with "← Back"
  while (entries.length < MAX_OPTIONS) entries.push(BACK);
  return entries;
}

/** Add a typed symbol to the text. The first letter of the text is a capital. */
export function applySymbol(typed: string, symbol: string): string {
  if (symbol === DELETE) return typed.slice(0, -1);
  if (symbol === SPACE) return typed.endsWith(' ') || typed === '' ? typed : typed + ' ';
  return typed === '' ? symbol.toUpperCase() : typed + symbol.toLowerCase();
}
