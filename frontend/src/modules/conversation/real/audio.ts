// Pure audio helpers for streaming the microphone to Muse Voice Transcribe.
// Muse wants: mono, 16-bit little-endian PCM at 16 kHz, in small chunks (we use 80 ms).
// Browsers give us Float32 samples at the sound card's rate (usually 44.1 or 48 kHz).

/** Must match SAMPLE_RATE in backend/app/services/muse.py. */
export const SAMPLE_RATE = 16_000;
export const CHUNK_MS = 80;
export const CHUNK_SAMPLES = (SAMPLE_RATE * CHUNK_MS) / 1000; // 1280

/** Float samples in -1..1 -> 16-bit signed integers. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/**
 * Shrink `input` to exactly `outLength` samples by averaging each window of input samples.
 * (Averaging is a cheap low-pass filter, which avoids the worst aliasing for speech.)
 */
export function downsample(input: Float32Array, outLength: number): Float32Array {
  if (input.length === outLength) return input;
  const ratio = input.length / outLength;
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / (end - start);
  }
  return out;
}

/**
 * Collects the small blocks the audio thread hands us (128 samples at a time) and emits
 * ready-to-send 80 ms chunks of 16 kHz PCM. Handles any input sample rate.
 */
export class PcmChunker {
  private buffer = new Float32Array(0);
  /** How many input samples make up one 80 ms chunk at the input rate. */
  private readonly inputBlock: number;

  constructor(inputRate: number) {
    this.inputBlock = Math.round((CHUNK_SAMPLES * inputRate) / SAMPLE_RATE);
  }

  /** Returns zero or more complete chunks (as ArrayBuffers, ready for `websocket.send`). */
  push(samples: Float32Array): ArrayBuffer[] {
    const merged = new Float32Array(this.buffer.length + samples.length);
    merged.set(this.buffer);
    merged.set(samples, this.buffer.length);

    const chunks: ArrayBuffer[] = [];
    let offset = 0;
    while (merged.length - offset >= this.inputBlock) {
      const block = merged.subarray(offset, offset + this.inputBlock);
      chunks.push(floatToPcm16(downsample(block, CHUNK_SAMPLES)).buffer as ArrayBuffer);
      offset += this.inputBlock;
    }
    this.buffer = merged.slice(offset);
    return chunks;
  }
}

/** Runs on the audio thread: forwards each 128-sample input block to the main thread. */
export const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true; // keep running
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;
