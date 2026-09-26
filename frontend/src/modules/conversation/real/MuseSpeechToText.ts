import type { SpeechToText, Transcript } from '../../../contracts';
import { createEmitter } from '../../../core/emitter';
import { PcmChunker, WORKLET_SOURCE } from './audio';

/** Messages from our backend relay (see backend/app/services/muse.py, normalize_event). */
type RelayMessage =
  | { type: 'ready' }
  | { type: 'transcript'; text: string; final: boolean }
  | { type: 'error'; message: string };

const MAX_FAILED_ATTEMPTS = 5;
/** If the socket falls this far behind, drop audio instead of piling up latency. */
const MAX_BUFFERED_BYTES = 512 * 1024;

/**
 * Speech-to-text with Meta's Muse Voice Transcribe, through our backend.
 *
 *   microphone -> AudioWorklet -> 16 kHz PCM chunks -> WebSocket -> backend -> Muse
 *                                        transcripts <-----------------------'
 *
 * The browser never sees the API key (the backend holds it). Muse detects where each sentence
 * ends ("endpointing"), so a `final` transcript means the partner finished speaking.
 * Sessions are limited to 60 minutes by Muse, so we reconnect automatically.
 */
export class MuseSpeechToText implements SpeechToText {
  private transcripts = createEmitter<Transcript>();
  private errors = createEmitter<string>();

  private wanted = false;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private workletUrl: string | null = null;
  private socket: WebSocket | null = null;
  private failedAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  onTranscript(handler: (transcript: Transcript) => void) {
    return this.transcripts.on(handler);
  }

  onError(handler: (message: string) => void) {
    return this.errors.on(handler);
  }

  start() {
    if (this.wanted) return;
    this.wanted = true;
    this.begin().catch((e) => {
      this.wanted = false;
      this.teardown();
      this.errors.emit(this.describe(e));
    });
  }

  stop() {
    this.wanted = false;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'endStream' }));
    }
    this.teardown();
  }

  // ---- microphone -> chunks --------------------------------------------------
  private async begin() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // Helps a lot when the laptop's own speakers play the user's reply.
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false, // the microphone stream never includes video
    });

    const context = new AudioContext();
    this.context = context;
    await context.resume();
    this.workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
    await context.audioWorklet.addModule(this.workletUrl);

    const chunker = new PcmChunker(context.sampleRate);
    const capture = new AudioWorkletNode(context, 'pcm-capture');
    capture.port.onmessage = (e: MessageEvent<Float32Array>) => {
      for (const chunk of chunker.push(e.data)) this.send(chunk);
    };

    // The worklet must be connected to the output to keep running; mute it so we hear nothing.
    const mute = context.createGain();
    mute.gain.value = 0;
    context.createMediaStreamSource(this.stream).connect(capture);
    capture.connect(mute).connect(context.destination);

    this.connect();
  }

  private send(chunk: ArrayBuffer) {
    const ws = this.socket;
    if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED_BYTES) ws.send(chunk);
  }

  // ---- WebSocket to our backend ------------------------------------------------
  private connect() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/api/stt/stream`);
    this.socket = ws;

    ws.onmessage = (e) => {
      const message = JSON.parse(e.data as string) as RelayMessage;
      if (message.type === 'ready') this.failedAttempts = 0;
      else if (message.type === 'transcript') {
        this.transcripts.emit({ text: message.text, isFinal: message.final });
      } else if (message.type === 'error') this.errors.emit(message.message);
    };

    ws.onclose = () => {
      if (!this.wanted || this.socket !== ws) return;
      if (++this.failedAttempts > MAX_FAILED_ATTEMPTS) {
        this.wanted = false;
        this.teardown();
        this.errors.emit('Speech recognition stopped: could not stay connected to the backend.');
        return;
      }
      // Back off: 1 s, 2 s, 4 s ... up to 10 s.
      const delay = Math.min(10_000, 1000 * 2 ** (this.failedAttempts - 1));
      this.reconnectTimer = setTimeout(() => this.wanted && this.connect(), delay);
    };
  }

  private teardown() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.socket;
    this.socket = null;
    ws?.close();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.context?.close();
    this.context = null;
    if (this.workletUrl) URL.revokeObjectURL(this.workletUrl);
    this.workletUrl = null;
  }

  private describe(e: unknown): string {
    if (e instanceof DOMException && e.name === 'NotAllowedError') {
      return 'Microphone permission was denied. Allow it in the browser and reload.';
    }
    if (e instanceof DOMException && e.name === 'NotFoundError') return 'No microphone found.';
    return `Could not start speech recognition: ${e instanceof Error ? e.message : String(e)}`;
  }
}
