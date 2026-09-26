import type { SpeechToText, Transcript } from '../../../contracts';
import { createEmitter } from '../../../core/emitter';

/** Fake microphone. The Dev Panel calls `simulate("...")` to pretend the partner spoke. */
export class MockSpeechToText implements SpeechToText {
  private emitter = createEmitter<Transcript>();

  start() {}
  stop() {}

  onTranscript(handler: (transcript: Transcript) => void) {
    return this.emitter.on(handler);
  }

  simulate(text: string) {
    this.emitter.emit({ text, isFinal: true });
  }
}
