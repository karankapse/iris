import type { ConversationTurn, Suggestion } from '../../../contracts';
import type { SuggestionFetcher } from '../conversationService';

import type { ApiUserProfile } from '../../../core/api';

const s = (i: number, text: string, tone: Suggestion['tone']): Suggestion => ({
  id: `canned-${i}`,
  text,
  tone,
});

/** Keyword-based fake "AI" so the UI works with no backend at all. */
export const cannedSuggestions: SuggestionFetcher = async (history: ConversationTurn[], _mood, profile?: ApiUserProfile) => {
  const last =
    [...history]
      .reverse()
      .find((t) => t.speaker === 'partner')
      ?.text.toLowerCase() ?? '';

  if (/(what is your name|who are you)/.test(last) && profile?.name) {
    return [
      s(1, `My name is ${profile.name}.`, 'happy'),
      s(2, `I am ${profile.name}.`, 'neutral'),
      s(3, "I'd rather not say right now.", 'serious'),
    ];
  }

  if (/(do you need anything|what do you need|can i get you something)/.test(last) && profile?.common_needs?.length) {
    return [
      s(1, `Yes, please ${profile.common_needs[0]}.`, 'neutral'),
      s(2, "No, I'm okay for now.", 'neutral'),
      s(3, "Just some water, thanks.", 'happy'),
    ];
  }

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
