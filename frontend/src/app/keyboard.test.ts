import { describe, expect, it } from 'vitest';
import { DELETE, DONE, SPACE, SYMBOLS, applySymbol, keyboardEntries, symbolsAt } from './keyboard';

/** Follow the keyboard to a symbol by always choosing the option that contains it. */
function pathTo(symbol: string): number[] {
  const path: number[] = [];
  for (let guard = 0; guard < 10; guard++) {
    const entries = keyboardEntries(path);
    const leaf = entries.find((e) => e.kind === 'symbol' && e.symbol === symbol);
    if (leaf) return path;
    const index = entries.findIndex(
      (e, i) => e.kind === 'group' && symbolsAt([...path, i]).includes(symbol),
    );
    if (index === -1) throw new Error(`cannot reach ${symbol}`);
    path.push(index);
  }
  throw new Error('too deep');
}

describe('eye keyboard', () => {
  it('never shows more than 4 options on any screen', () => {
    const check = (path: number[]) => {
      const entries = keyboardEntries(path);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.length).toBeLessThanOrEqual(4);
      entries.forEach((e, i) => e.kind === 'group' && check([...path, i]));
    };
    check([]);
  });

  it('can reach every symbol, in at most 3 selections', () => {
    for (const symbol of SYMBOLS) {
      const path = pathTo(symbol);
      expect(path.length).toBeLessThanOrEqual(2); // 2 group picks + 1 final pick = 3 selections
    }
  });

  it('starts with groups that together cover every symbol once', () => {
    const covered = keyboardEntries([]).flatMap((_, i) => symbolsAt([i]));
    expect([...covered].sort()).toEqual([...SYMBOLS].sort());
  });

  it('labels the special keys so they are readable', () => {
    const labels = SYMBOLS.map((s) => {
      const path = pathTo(s);
      return keyboardEntries(path).find((e) => e.kind === 'symbol' && e.symbol === s)!.label;
    });
    expect(labels).toContain('␣ space');
    expect(labels).toContain('⌫ delete');
    expect(labels).toContain('✓ use this reply');
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
