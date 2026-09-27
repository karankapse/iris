// "Stop speaking" must always finish the reply, or the app waits forever on the speaking
// screen with the microphone ignored (a paused <audio> never fires "ended").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TtsProvider } from '../../../contracts';
import { ClonedTts } from './ClonedTts';

class FakeAudio {
  static made: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  currentTime = 0;
  paused = true;
  constructor(public src: string) {
    FakeAudio.made.push(this);
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true; // like a real <audio>: pausing does NOT fire "ended"
  }
}

const fallback = (): TtsProvider & { spoken: string[] } => {
  const f = {
    spoken: [] as string[],
    speak: vi.fn(async (t: string) => void f.spoken.push(t)),
    cancel: vi.fn(),
  };
  return f;
};

let release: (() => void) | null;
beforeEach(() => {
  FakeAudio.made = [];
  release = null;
  vi.stubGlobal('Audio', FakeAudio);
  URL.createObjectURL = vi.fn(() => 'blob:voice');
  URL.revokeObjectURL = vi.fn();
  // the voice arrives when the test calls release(); aborting rejects like a real fetch
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((resolve, reject) => {
          release = () => resolve(new Response(new Blob(['mp3']), { status: 200 }));
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('ClonedTts: Stop speaking', () => {
  it('stopping while it plays finishes the reply', async () => {
    const tts = new ClonedTts(fallback());
    const done = tts.speak('Hello there', 'happy');
    release!();
    await vi.waitFor(() => expect(FakeAudio.made[0]?.paused).toBe(false));
    tts.cancel();
    await expect(done).resolves.toBeUndefined();
    expect(FakeAudio.made[0].paused).toBe(true);
  });

  it('stopping while the voice is still being made finishes it, and nothing plays later', async () => {
    const f = fallback();
    const tts = new ClonedTts(f);
    const done = tts.speak('Hello there', 'happy');
    tts.cancel(); // before the voice arrived
    await expect(done).resolves.toBeUndefined();
    expect(FakeAudio.made).toHaveLength(0);
    expect(f.speak).not.toHaveBeenCalled(); // no browser voice either
  });

  it('if the cloned clip fails, the reply ends only after the browser voice said it', async () => {
    const f = fallback();
    const tts = new ClonedTts(f);
    const done = tts.speak('Hello there', 'happy');
    release!();
    await vi.waitFor(() => expect(FakeAudio.made).toHaveLength(1));
    FakeAudio.made[0].onerror?.(new Event('error'));
    await done;
    expect(f.spoken).toEqual(['Hello there']);
  });
});
