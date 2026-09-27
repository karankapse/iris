import type { Emotion, TtsProvider } from '../../../contracts';
import { getUserId } from '../../../core/auth';
import { BrowserTts } from './BrowserTts';

/**
 * Expressive emotional TTS using ElevenLabs with the user's cloned voice.
 * Emotion dynamically modulates stability, style exaggeration, and speed.
 * Falls back seamlessly to BrowserTts if no cloned voice is active or offline.
 */
export class ClonedTts implements TtsProvider {
  private currentAudio: HTMLAudioElement | null = null;
  private fallback: TtsProvider;
  /** Bumped by cancel() and each new speak(): an older reply must not start playing late. */
  private generation = 0;
  /** Finishes the reply in progress (resolves its speak() promise). */
  private finishCurrent: (() => void) | null = null;
  private fetching: AbortController | null = null;

  constructor(fallback: TtsProvider = new BrowserTts()) {
    this.fallback = fallback;
  }

  async speak(text: string, emotion: Emotion): Promise<void> {
    this.cancel();
    const generation = this.generation;
    const stopped = () => generation !== this.generation;

    try {
      console.info(
        `[ClonedTts] Requesting ElevenLabs speech for: "${text}" with emotion: "${emotion}"`,
      );
      const fetching = new AbortController();
      this.fetching = fetching;
      const res = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          emotion,
          user_id: getUserId(), // the logged-in person's own (cloned) voice
        }),
        signal: fetching.signal,
      });
      if (stopped()) return; // "Stop speaking" while the voice was still being made

      if (!res.ok) {
        const errDetail = await res.text().catch(() => res.statusText);
        console.warn(
          `[ClonedTts] /api/voice/speak returned ${res.status}: ${errDetail}. Falling back to browser voice.`,
        );
        return await this.fallback.speak(text, emotion);
      }

      const blob = await res.blob();
      if (stopped()) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.currentAudio = audio;

      return await new Promise<void>((resolve) => {
        let finished = false;
        // Every way the clip can end (played out, stopped, failed) finishes the reply exactly once.
        const finish = (fallbackToBrowser = false) => {
          if (finished) return;
          finished = true;
          URL.revokeObjectURL(url);
          if (this.currentAudio === audio) this.currentAudio = null;
          if (this.finishCurrent === finishStopped) this.finishCurrent = null;
          if (fallbackToBrowser && !stopped()) {
            // the reply is only done once the browser voice has said it
            this.fallback.speak(text, emotion).finally(resolve);
          } else {
            resolve();
          }
        };
        const finishStopped = () => finish();
        this.finishCurrent = finishStopped;

        audio.onended = () => finish();
        audio.onerror = (e) => {
          console.warn('[ClonedTts] Audio element playback error:', e);
          finish(true);
        };
        audio.play().catch((err) => {
          if (stopped()) return finish(); // stopped before playback started: not an error
          console.warn('[ClonedTts] Audio play() promise rejected:', err);
          finish(true);
        });
      });
    } catch (e) {
      if (stopped()) return; // the fetch was aborted by "Stop speaking"
      console.warn('[ClonedTts] Failed to contact voice backend, falling back:', e);
      return await this.fallback.speak(text, emotion);
    }
  }

  /** Stop right away. Whatever was being said (or still fetched) counts as finished. */
  cancel(): void {
    this.generation++;
    this.fetching?.abort();
    this.fetching = null;
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    // A paused clip never fires "ended", so finish the pending reply ourselves; otherwise the
    // app would wait forever on the speaking screen with the microphone ignored.
    const finish = this.finishCurrent;
    this.finishCurrent = null;
    finish?.();
    this.fallback.cancel();
  }
}
