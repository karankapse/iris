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
