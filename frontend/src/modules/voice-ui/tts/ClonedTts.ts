import type { Emotion, SpeakOptions, TtsProvider } from '../../../contracts';
import { getUserId } from '../../../core/auth';
import { BrowserTts } from './BrowserTts';

/** If the cloned voice hasn't started PLAYING by then, say it with the browser voice right away
 * (the answer is spoken now, never later). */
const FIRST_AUDIO_TIMEOUT_MS = 4000;

/**
 * A URL that plays the MP3 while it is still downloading (MediaSource), so the voice starts
 * with the first chunk instead of after the whole clip. Null where the browser can't do that.
 */
function streamingUrl(body: ReadableStream<Uint8Array<ArrayBuffer>> | null): string | null {
  if (!body || typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported('audio/mpeg')) {
    return null;
  }
  const source = new MediaSource();
  source.addEventListener(
    'sourceopen',
    async () => {
      try {
        const buffer = source.addSourceBuffer('audio/mpeg');
        const reader = body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer.appendBuffer(value);
          await new Promise((resolve) =>
            buffer.addEventListener('updateend', resolve, { once: true }),
          );
        }
        if (source.readyState === 'open') source.endOfStream();
      } catch {
        // stopped (cancel aborts the download) or the connection dropped
        if (source.readyState === 'open') source.endOfStream('network');
      }
    },
    { once: true },
  );
  return URL.createObjectURL(source);
}

/**
 * Expressive emotional TTS using ElevenLabs with the user's cloned voice.
 * Emotion dynamically modulates stability, style exaggeration, and speed.
 * Falls back seamlessly to BrowserTts if no cloned voice is active, offline or slow.
 * `speak()` always settles: when the audio ends, fails, or is stopped with cancel().
 */
export class ClonedTts implements TtsProvider {
  private currentAudio: HTMLAudioElement | null = null;
  private fallback: TtsProvider;
  /** Stops the reply in progress (aborts the request, ends the audio, settles speak()). */
  private stopCurrent: (() => void) | null = null;

  constructor(fallback: TtsProvider = new BrowserTts()) {
    this.fallback = fallback;
  }

  async speak(text: string, emotion: Emotion, options: SpeakOptions = {}): Promise<void> {
    this.cancel();
    let stopped = false;
    const controller = new AbortController();
    let finish: (played: boolean) => void = () => {};
    const timer = setTimeout(() => {
      controller.abort();
      finish(false);
    }, FIRST_AUDIO_TIMEOUT_MS);
    this.stopCurrent = () => {
      stopped = true;
      controller.abort();
      finish(true);
    };
    const speakFallback = () => (stopped ? undefined : this.fallback.speak(text, emotion, options));

    try {
      const res = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          emotion,
          user_id: getUserId(), // the logged-in person's own (cloned) voice
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn(
          `[ClonedTts] /api/voice/speak returned ${res.status}: using the browser voice.`,
        );
        return await speakFallback();
      }
      const url = streamingUrl(res.body) ?? URL.createObjectURL(await res.blob());
      if (stopped) return URL.revokeObjectURL(url);

      const audio = new Audio(url);
      this.currentAudio = audio;
      const played = await new Promise<boolean>((resolve) => {
        finish = resolve;
        audio.onplaying = () => clearTimeout(timer); // it's being heard: no more time limit
        audio.onended = () => resolve(true);
        audio.onerror = () => resolve(false);
        audio.play().catch(() => resolve(false));
      });
      if (!played) audio.pause(); // too late or failed: it must not start playing afterwards
      URL.revokeObjectURL(url);
      if (this.currentAudio === audio) this.currentAudio = null;
      // (if part of it was already heard, don't start over in the other voice)
      if (!played && audio.currentTime === 0) {
        console.warn('[ClonedTts] Audio playback failed: using the browser voice.');
        return await speakFallback();
      }
    } catch (e) {
      if (stopped) return;
      console.warn(
        '[ClonedTts] Voice backend failed or never answered: using the browser voice.',
        e,
      );
      return await speakFallback();
    } finally {
      clearTimeout(timer);
    }
  }

  cancel(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    this.stopCurrent?.();
    this.stopCurrent = null;
    this.fallback.cancel();
  }
}
