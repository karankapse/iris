import type { SpeechToText, Transcript } from '../../../contracts';
import { createEmitter } from '../../../core/emitter';

// The Web Speech API isn't in TypeScript's built-in DOM types yet, so describe the bits we use.
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

/**
 * Speech-to-text via the browser's Web Speech API (works in Chrome and Edge).
 * PRIVACY NOTE: in Chrome this sends audio to Google's servers for recognition. It's fine for
 * development; for real use we plan a local Whisper implementation of the same interface.
 */
export class WebSpeechToText implements SpeechToText {
  private emitter = createEmitter<Transcript>();
  private recognition: Recognition | null = null;
  private wanted = false;

  start() {
    const w = window as unknown as {
      SpeechRecognition?: RecognitionCtor;
      webkitSpeechRecognition?: RecognitionCtor;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) throw new Error('Speech recognition is not supported in this browser. Use Chrome.');

    this.wanted = true;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        this.emitter.emit({ text: r[0].transcript.trim(), isFinal: r.isFinal });
      }
    };
    // The browser stops recognition after silence; restart while we still want it.
    rec.onend = () => {
      if (this.wanted) rec.start();
    };
    rec.onerror = (e) => console.warn('[stt] error:', e.error);
    rec.start();
    this.recognition = rec;
  }

  stop() {
    this.wanted = false;
    this.recognition?.stop();
    this.recognition = null;
  }

  onTranscript(handler: (transcript: Transcript) => void) {
    return this.emitter.on(handler);
  }
}
