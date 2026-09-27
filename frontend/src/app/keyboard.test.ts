import { describe, expect, it } from 'vitest';
import { DELETE, DONE, SPACE, SYMBOLS, applySymbol, keyboardEntries, symbolsAt } from './keyboard';

/** Follow the keyboard to a symbol by always choosing the option that contains it. */
function pathTo(symbol: string): number[] {
  const path: number[] = [];
  for (let guard = 0; guard < 10; guard++) {
    const entries = keyboardEntries(path);
    if (entries.some((e) => e.kind === 'symbol' && e.symbol === symbol)) return path;
    const index = entries.findIndex(
      (e, i) => e.kind === 'group' && symbolsAt([...path, i]).includes(symbol),
    );
    if (index === -1) throw new Error(`cannot reach ${symbol}`);
    path.push(index);
  }
  throw new Error('too deep');
}

describe('eye keyboard', () => {
  it('EVERY screen has exactly 3 options (never a blank slot)', () => {
    const check = (path: number[]) => {
      const entries = keyboardEntries(path);
      expect(entries).toHaveLength(3);
      entries.forEach((e, i) => e.kind === 'group' && check([...path, i]));
    };
    check([]);
  });

  it('can reach every symbol, in at most 4 selections', () => {
    for (const symbol of SYMBOLS) expect(pathTo(symbol).length).toBeLessThanOrEqual(3); // 3 groups + 1 symbol
  });

  it('starts with 3 groups that together cover every symbol once', () => {
    const covered = keyboardEntries([]).flatMap((_, i) => symbolsAt([i]));
    expect([...covered].sort()).toEqual([...SYMBOLS].sort());
  });

  it('labels the special keys so they are readable', () => {
    const labels = SYMBOLS.map(
      (s) => keyboardEntries(pathTo(s)).find((e) => e.kind === 'symbol' && e.symbol === s)!.label,
    );
    expect(labels).toContain('␣ space');
    expect(labels).toContain('⌫ delete');
    expect(labels).toContain('✓ use this reply');
  });

  it('fills short screens with "← Back" instead of leaving a gap', () => {
    const leaf = keyboardEntries(pathTo('A'));
    expect(leaf.filter((e) => e.kind === 'back').length).toBeGreaterThan(0);
    expect(leaf.some((e) => e.kind === 'symbol' && e.symbol === 'A')).toBe(true);
  });
});

describe('applySymbol', () => {
  it('types a sentence: capital first, then lowercase, spaces and delete', () => {
    let text = '';
    for (const s of ['H', 'I', SPACE, 'T', 'O', 'O']) text = applySymbol(text, s);
    expect(text).toBe('Hi too');
    expect(applySymbol(text, DELETE)).toBe('Hi to');
  });

  it('ignores leading and double spaces, and delete on empty text', () => {
    expect(applySymbol('', SPACE)).toBe('');
    expect(applySymbol('Hi ', SPACE)).toBe('Hi ');
    expect(applySymbol('', DELETE)).toBe('');
  });

  it('DONE is not a character (the machine handles it)', () => {
    expect(DONE).toBe('✓');
  });
});
