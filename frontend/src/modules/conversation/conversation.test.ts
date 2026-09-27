import { describe, expect, it } from 'vitest';
import { HistoryConversationService } from './conversationService';
import { cannedSuggestions } from './mock/cannedSuggestions';

describe('HistoryConversationService', () => {
  it('remembers turns and passes them to the fetcher', async () => {
    let seen = 0;
    const svc = new HistoryConversationService(async (history) => {
      seen = history.length;
      return [];
    });
    svc.addTurn({ speaker: 'partner', text: 'hi' });
    svc.addTurn({ speaker: 'user', text: 'hello' });
    await svc.suggestReplies(null);
    expect(seen).toBe(2);
  });

  it('never returns more than 4 suggestions', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `${i}`,
      text: 'x',
      tone: 'neutral' as const,
    }));
    const svc = new HistoryConversationService(async () => many);
    expect(await svc.suggestReplies(null)).toHaveLength(4);
  });
  it('forwards mood, profile, and reaction to the fetcher', async () => {
    let capturedReaction = null;
    const svc = new HistoryConversationService(async (_history, _mood, _profile, reaction) => {
      capturedReaction = reaction;
      return [];
    });
    await svc.suggestReplies('neutral', undefined, 'happy');
    expect(capturedReaction).toBe('happy');
  });
});

describe('HistoryConversationService: how the moment feels', () => {
  it('sends the face reading and passes back the AI’s read of the moment', async () => {
    const face = { scores: { happy: 0.7 }, peak: 'happy' as const, confidence: 0.8 };
    const emotion = {
      emotion: 'happy' as const,
      confidence: 0.8,
      reason: 'smiling',
      source: 'face' as const,
    };
    let seenFace = null;
    const svc = new HistoryConversationService(async (_h, _m, _p, _r, f) => {
      seenFace = f;
      return { suggestions: [{ id: '1', text: 'Yes!', tone: 'happy' }], emotion };
    });
    const out = await svc.suggestRepliesWithEmotion(null, undefined, 'happy', face);
    expect(seenFace).toEqual(face);
    expect(out.emotion).toEqual(emotion);
    expect(await svc.suggestReplies(null)).toHaveLength(1);
  });

  it('a fetcher that returns only replies has no emotion', async () => {
    const svc = new HistoryConversationService(async () => [
      { id: '1', text: 'x', tone: 'neutral' },
    ]);
    expect((await svc.suggestRepliesWithEmotion(null)).emotion).toBeNull();
  });
});

describe('cannedSuggestions', () => {
  it('answers a hunger question with food-related replies', async () => {
    const out = await cannedSuggestions([{ speaker: 'partner', text: 'Are you hungry?' }], null);
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out[0].text.toLowerCase()).toContain('eat');
  });

  it('suggests celebratory responses when partner shares job news and reaction is happy', async () => {
    const out = await cannedSuggestions(
      [{ speaker: 'partner', text: 'you got a job' }],
      null,
      undefined,
      'happy',
    );
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.some((s) => s.text.toLowerCase().includes('congrats'))).toBe(true);
    expect(out[0].tone).toBe('happy');
  });

  it('suggests serious responses when reaction is serious', async () => {
    const out = await cannedSuggestions(
      [{ speaker: 'partner', text: 'you got a job' }],
      null,
      undefined,
      'serious',
    );
    expect(out[0].tone).toBe('serious');
    expect(out[0].text.toLowerCase()).toContain('serious');
  });
});
