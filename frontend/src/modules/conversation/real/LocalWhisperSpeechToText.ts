import type { SpeechToText, SttStatus, Transcript } from '../../../contracts';
import { createEmitter } from '../../../core/emitter';
import { PcmChunker, WORKLET_SOURCE } from './audio';

type RelayMessage =
  | { type: 'ready' }
  | { type: 'transcript'; text: string; final: boolean }
  | { type: 'error'; message: string }
  | { type: 'status'; message: string };

const MAX_FAILED_ATTEMPTS = 5;
const MAX_BUFFERED_BYTES = 512 * 1024;

export class LocalWhisperSpeechToText implements SpeechToText {
  private transcripts = createEmitter<Transcript>();
  private errors = createEmitter<string>();
  private statuses = createEmitter<SttStatus>();

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

  onStatus(handler: (status: SttStatus) => void) {
    return this.statuses.on(handler);
  }

  private setStatus(state: SttStatus['state'], detail?: string) {
    this.statuses.emit({ state, engine: 'Local Whisper AI', detail });
  }

  start() {
    if (this.wanted) return;
    this.wanted = true;
    this.setStatus('connecting');
    this.begin().catch((e) => {
      this.wanted = false;
      this.teardown();
      const message = this.describe(e);
      this.setStatus('error', message);
      this.errors.emit(message);
    });
  }

  stop() {
    this.wanted = false;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'endStream' }));
    }
    this.teardown();
    this.setStatus('off');
  }

  private async begin() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
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

  private connect() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/api/stt/whisper`);
    this.socket = ws;

    ws.onmessage = (e) => {
      const message = JSON.parse(e.data as string) as RelayMessage;
      if (message.type === 'ready') {
        this.failedAttempts = 0;
        this.setStatus('listening');
      } else if (message.type === 'transcript') {
        this.transcripts.emit({ text: message.text, isFinal: message.final });
      } else if (message.type === 'error') {
        this.setStatus('error', message.message);
        this.errors.emit(message.message);
      } else if (message.type === 'status') {
        this.setStatus('listening', message.message);
      }
    };

    ws.onclose = () => {
      if (!this.wanted || this.socket !== ws) return;
      if (++this.failedAttempts > MAX_FAILED_ATTEMPTS) {
        this.wanted = false;
        this.teardown();
        const message = 'Speech recognition stopped: could not stay connected to the backend.';
        this.setStatus('error', message);
        this.errors.emit(message);
        return;
      }
      this.setStatus('connecting');
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
