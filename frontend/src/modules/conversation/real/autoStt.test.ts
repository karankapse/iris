import { describe, expect, it } from 'vitest';
import { pickEngine } from './AutoSpeechToText';

describe('pickEngine (which speech engine gets your microphone audio)', () => {
  it('uses Meta Muse when the backend has a key', async () => {
    expect(await pickEngine(async () => ({ stt_configured: true }))).toBe('muse');
  });

  it('falls back to Chrome speech when the backend has no key', async () => {
    expect(await pickEngine(async () => ({ stt_configured: false }))).toBe('webspeech');
    expect(await pickEngine(async () => ({}))).toBe('webspeech');
  });

  it('falls back to Chrome speech when the backend cannot be reached', async () => {
    expect(
      await pickEngine(async () => {
        throw new Error('connection refused');
      }),
    ).toBe('webspeech');
  });
});
