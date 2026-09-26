import type { SpeechToText, SttStatus, Transcript } from '../../../contracts';
import { createEmitter } from '../../../core/emitter';
import { MuseSpeechToText } from './MuseSpeechToText';
import { WebSpeechToText } from './WebSpeechToText';

export type Engine = 'muse' | 'webspeech';

/**
 * Meta Muse if the backend has a key for it, otherwise Chrome's built-in recognition so the
 * microphone still works while the key is missing.
 */
export async function pickEngine(
  fetchHealth: () => Promise<{ stt_configured?: boolean }>,
): Promise<Engine> {
  try {
    return (await fetchHealth()).stt_configured ? 'muse' : 'webspeech';
  } catch {
    return 'webspeech'; // backend not reachable: Muse can't work without it
  }
}

const FALLBACK_NOTE =
  'No Meta Muse key on the backend (MODEL_API_KEY), so this uses Chrome speech recognition. ' +
  'That sends microphone audio to Google. Add the key to .env and restart to use Muse instead.';

export class AutoSpeechToText implements SpeechToText {
  private transcripts = createEmitter<Transcript>();
  private errors = createEmitter<string>();
  private statuses = createEmitter<SttStatus>();
  private inner: SpeechToText | null = null;
  private unsubs: (() => void)[] = [];
  private wanted = false;

  start() {
    this.wanted = true;
    this.statuses.emit({ state: 'connecting', engine: 'choosing…' });
    void this.begin();
  }

  stop() {
    this.wanted = false;
    this.inner?.stop();
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.inner = null;
    this.statuses.emit({ state: 'off', engine: '' });
  }

  onTranscript(handler: (transcript: Transcript) => void) {
    return this.transcripts.on(handler);
  }
  onError(handler: (message: string) => void) {
    return this.errors.on(handler);
  }
  onStatus(handler: (status: SttStatus) => void) {
    return this.statuses.on(handler);
  }

  private async begin() {
    const engine = await pickEngine(() => fetch('/api/health').then((r) => r.json()));
    if (!this.wanted) return; // stopped while we were choosing

    const inner: SpeechToText = engine === 'muse' ? new MuseSpeechToText() : new WebSpeechToText();
    this.inner = inner;
    this.unsubs = [
      inner.onTranscript((t) => this.transcripts.emit(t)),
      inner.onError?.((m) => this.errors.emit(m)) ?? (() => {}),
      inner.onStatus?.((s) =>
        this.statuses.emit({
          ...s,
          detail: s.detail ?? (engine === 'webspeech' ? FALLBACK_NOTE : undefined),
        }),
      ) ?? (() => {}),
    ];
    try {
      inner.start();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.statuses.emit({ state: 'error', engine: 'none', detail: message });
      this.errors.emit(message);
    }
  }
}
