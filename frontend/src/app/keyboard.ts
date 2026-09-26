// A simple eye-controlled keyboard that never shows more than 4 options at once.
//
// 29 symbols (A-Z, space, delete, done) don't fit on one screen, so they are split into groups:
//   screen 1: 4 groups of ~8 symbols   -> pick one
//   screen 2: 4 groups of ~2 symbols   -> pick one
//   screen 3: the 2 symbols themselves -> pick one
// That is 3 selections per letter. It is slow but works with big targets and very coarse gaze.
// (A later improvement: word prediction as one of the 4 options.)

export const SPACE = ' ';
export const DELETE = '⌫';
export const DONE = '✓';

export const SYMBOLS: string[] = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', SPACE, DELETE, DONE];

const MAX_OPTIONS = 4;

/** Split a list into at most `parts` near-equal consecutive chunks. */
export function chunk<T>(items: T[], parts = MAX_OPTIONS): T[][] {
  const size = Math.ceil(items.length / parts);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The symbols still reachable after following `path` (each step = which group was chosen). */
export function symbolsAt(path: number[]): string[] {
  let symbols = SYMBOLS;
  for (const index of path) {
    const groups = symbols.length <= MAX_OPTIONS ? symbols.map((s) => [s]) : chunk(symbols);
    symbols = groups[index] ?? symbols;
  }
  return symbols;
}

export type KeyEntry =
  | { kind: 'group'; index: number; label: string }
  | { kind: 'symbol'; symbol: string; label: string };

const NAME: Record<string, string> = {
  [SPACE]: '␣ space',
  [DELETE]: '⌫ delete',
  [DONE]: '✓ use this reply',
};
const SHORT: Record<string, string> = { [SPACE]: '␣', [DELETE]: '⌫', [DONE]: '✓' };

/** What to show for the current position: groups (when there are more than 4 symbols) or the symbols. */
export function keyboardEntries(path: number[]): KeyEntry[] {
  const symbols = symbolsAt(path);
  if (symbols.length <= MAX_OPTIONS) {
    return symbols.map((symbol) => ({ kind: 'symbol', symbol, label: NAME[symbol] ?? symbol }));
  }
  return chunk(symbols).map((group, index) => ({
    kind: 'group',
    index,
    label: group.map((s) => SHORT[s] ?? s).join(' '),
  }));
}

/** Add a typed symbol to the text. The first letter of the text is a capital. */
export function applySymbol(typed: string, symbol: string): string {
  if (symbol === DELETE) return typed.slice(0, -1);
  if (symbol === SPACE) return typed.endsWith(' ') || typed === '' ? typed : typed + ' ';
  return typed === '' ? symbol.toUpperCase() : typed + symbol.toLowerCase();
}
