import type { SpeechToText, SttStatus, Transcript } from '../../../contracts';
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
  onstart: (() => void) | null;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

const ENGINE = 'Chrome speech';
/** Pause before restarting after the browser stops recognition, so a failure can't spin. */
const RESTART_DELAY_MS = 400;

/**
 * Speech-to-text via the browser's Web Speech API (works in Chrome and Edge).
 * PRIVACY NOTE: in Chrome this sends audio to Google's servers for recognition. It is used when
 * no Meta Muse key is configured (see AutoSpeechToText); the UI says so.
 */
export class WebSpeechToText implements SpeechToText {
  private transcripts = createEmitter<Transcript>();
  private errors = createEmitter<string>();
  private statuses = createEmitter<SttStatus>();
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
    this.setStatus('connecting');
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onstart = () => this.setStatus('listening');
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (text) this.transcripts.emit({ text, isFinal: r.isFinal });
      }
    };
    rec.onerror = (e) => this.handleError(e.error);
    // The browser ends recognition after silence or a hiccup; keep going while we still want it.
    rec.onend = () => {
      if (!this.wanted || this.recognition !== rec) return;
      setTimeout(() => {
        if (!this.wanted || this.recognition !== rec) return;
        try {
          rec.start();
        } catch {
          /* already started */
        }
      }, RESTART_DELAY_MS);
    };
    this.recognition = rec;
    rec.start();
  }

  stop() {
    this.wanted = false;
    this.recognition?.stop();
    this.recognition = null;
    this.setStatus('off');
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

  private setStatus(state: SttStatus['state'], detail?: string) {
    this.statuses.emit({ state, engine: ENGINE, detail });
  }

  /** Chrome reports problems with short codes; turn them into something a person can act on. */
  private handleError(code: string) {
    const fatal = (message: string) => {
      this.wanted = false;
      this.recognition?.stop();
      this.setStatus('error', message);
      this.errors.emit(message);
    };
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed':
        return fatal(
          'Microphone permission was denied. Allow the microphone in Chrome and reload.',
        );
      case 'audio-capture':
        return fatal('No microphone was found.');
      case 'network':
        // Chrome's recognizer needs to reach Google; we retry on the next restart.
        this.setStatus('error', 'Cannot reach the speech service (network). Retrying…');
        return;
      case 'no-speech': // just silence
      case 'aborted': // we stopped it ourselves
        return;
      default:
        this.setStatus('error', `Speech recognition error: ${code}`);
    }
  }
}
