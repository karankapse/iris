import { describe, expect, it } from 'vitest';
import { CHUNK_SAMPLES, downsample, floatToPcm16, PcmChunker } from './audio';

describe('floatToPcm16', () => {
  it('maps -1, 0, 1 to the 16-bit extremes and clips out-of-range values', () => {
    const pcm = floatToPcm16(new Float32Array([-1, 0, 1, 2, -3]));
    expect(Array.from(pcm)).toEqual([-32768, 0, 32767, 32767, -32768]);
  });
});

describe('downsample', () => {
  it('averages windows of samples', () => {
    const out = downsample(new Float32Array([1, 1, 1, 0, 0, 0]), 2);
    expect(Array.from(out)).toEqual([1, 0]);
  });

  it('returns the input untouched when sizes already match', () => {
    const input = new Float32Array([0.5, -0.5]);
    expect(downsample(input, 2)).toBe(input);
  });
});

describe('PcmChunker', () => {
  const block = (n: number) => new Float32Array(n).fill(0.25);

  it('at 16 kHz emits an 80 ms chunk (1280 samples = 2560 bytes) once enough audio arrived', () => {
    const chunker = new PcmChunker(16_000);
    // The audio thread delivers 128 samples at a time: 9 blocks are not enough, 10 are.
    let chunks: ArrayBuffer[] = [];
    for (let i = 0; i < 9; i++) chunks.push(...chunker.push(block(128)));
    expect(chunks).toHaveLength(0);
    chunks = chunker.push(block(128));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].byteLength).toBe(CHUNK_SAMPLES * 2);
  });

  it('at 48 kHz still produces 1280-sample chunks, one per 80 ms of input', () => {
    const chunker = new PcmChunker(48_000);
    const chunks = chunker.push(block(48_000 * 0.24)); // 240 ms of audio
    expect(chunks).toHaveLength(3);
    for (const c of chunks) expect(c.byteLength).toBe(CHUNK_SAMPLES * 2);
  });

  it('works at 44.1 kHz and keeps leftover samples for the next chunk', () => {
    const chunker = new PcmChunker(44_100);
    expect(chunker.push(block(3000))).toHaveLength(0); // 3528 needed
    expect(chunker.push(block(600))).toHaveLength(1); // 3600 total -> 1 chunk, 72 left over
  });

  it('preserves the signal level through resampling', () => {
    const [chunk] = new PcmChunker(48_000).push(block(3840));
    const first = new Int16Array(chunk)[0];
    expect(first).toBeCloseTo(0.25 * 32767, -1);
  });
});
