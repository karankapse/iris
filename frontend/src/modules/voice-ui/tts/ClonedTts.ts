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

  constructor(fallback: TtsProvider = new BrowserTts()) {
    this.fallback = fallback;
  }

  async speak(text: string, emotion: Emotion): Promise<void> {
    this.cancel();

    try {
      console.info(
        `[ClonedTts] Requesting ElevenLabs speech for: "${text}" with emotion: "${emotion}"`,
      );
      const res = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          emotion,
          user_id: getUserId(), // the logged-in person's own (cloned) voice
        }),
      });

      if (!res.ok) {
        const errDetail = await res.text().catch(() => res.statusText);
        console.warn(
          `[ClonedTts] /api/voice/speak returned ${res.status}: ${errDetail}. Falling back to browser voice.`,
        );
        return await this.fallback.speak(text, emotion);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.currentAudio = audio;

      return await new Promise<void>((resolve) => {
        let finished = false;
        const cleanup = () => {
          if (!finished) {
            finished = true;
            URL.revokeObjectURL(url);
            if (this.currentAudio === audio) {
              this.currentAudio = null;
            }
            resolve();
          }
        };

        audio.onended = () => {
          cleanup();
        };

        audio.onerror = (e) => {
          console.warn('[ClonedTts] Audio element playback error:', e);
          cleanup();
          void this.fallback.speak(text, emotion);
        };

        audio.play().catch((err) => {
          console.warn('[ClonedTts] Audio play() promise rejected:', err);
          cleanup();
          void this.fallback.speak(text, emotion);
        });
      });
    } catch (e) {
      console.warn('[ClonedTts] Failed to contact voice backend, falling back:', e);
      return await this.fallback.speak(text, emotion);
    }
  }

  cancel(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    this.fallback.cancel();
  }
}
