import type { ConversationTurn, Suggestion } from '../../../contracts';
import type { SuggestionFetcher } from '../conversationService';

const s = (i: number, text: string, tone: Suggestion['tone']): Suggestion => ({
  id: `canned-${i}`,
  text,
  tone,
});

/** Keyword-based fake "AI" so the UI works with no backend at all. */
export const cannedSuggestions: SuggestionFetcher = async (history: ConversationTurn[]) => {
  const last =
    [...history]
      .reverse()
      .find((t) => t.speaker === 'partner')
      ?.text.toLowerCase() ?? '';
  if (/(pain|hurt|uncomfortable)/.test(last)) {
    return [
      s(1, 'Yes, it hurts a lot right now.', 'serious'),
      s(2, 'A little, but I can manage.', 'neutral'),
      s(3, 'Please adjust my pillow.', 'neutral'),
    ];
  }
  if (/(hungry|eat|food|dinner|lunch)/.test(last)) {
    return [
      s(1, "Yes, I'd love something to eat!", 'happy'),
      s(2, 'Maybe a little later.', 'neutral'),
      s(3, 'Anything but soup, please.', 'joking'),
    ];
  }
  if (/(how are you|feeling|how do you feel)/.test(last)) {
    return [
      s(1, "I'm feeling good today.", 'happy'),
      s(2, 'A bit tired, honestly.', 'sad'),
      s(3, "Better now that you're here.", 'happy'),
    ];
  }
  return [
    s(1, 'Yes.', 'neutral'),
    s(2, 'No, thank you.', 'neutral'),
    s(3, 'Can you say that again?', 'neutral'),
    s(4, 'I love you.', 'happy'),
  ];
};
