import { afterEach, describe, expect, it } from 'vitest';
import { withoutGlobalModule } from './isolateModule';

const g = globalThis as { Module?: unknown };

describe('withoutGlobalModule', () => {
  afterEach(() => {
    g.Module = undefined;
  });

  it("hides another engine's global Module while ours starts, then puts it back", async () => {
    const webgazers = { name: 'webgazer face mesh' };
    g.Module = webgazers;
    const seen = await withoutGlobalModule(async () => g.Module);
    expect(seen).toBeUndefined();
    expect(g.Module).toBe(webgazers);
  });

  it('restores it even if starting fails', async () => {
    const webgazers = {};
    g.Module = webgazers;
    await expect(
      withoutGlobalModule(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(g.Module).toBe(webgazers);
  });
});
