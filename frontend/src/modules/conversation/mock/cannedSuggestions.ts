import type { ConversationTurn, Suggestion } from '../../../contracts';
import type { SuggestionFetcher } from '../conversationService';

const s = (i: number, text: string, tone: Suggestion['tone']): Suggestion => ({
  id: `canned-${i}`,
  text,
  tone,
});

/** Keyword-based fake "AI" so the UI works with no backend at all. */
export const cannedSuggestions: SuggestionFetcher = async (
  history: ConversationTurn[],
  mood = null,
  profile?,
  reaction = null,
) => {
  const last =
    [...history]
      .reverse()
      .find((t) => t.speaker === 'partner')
      ?.text.toLowerCase() ?? '';
  const activeEmotion = reaction ?? mood ?? 'neutral';

  // Profile-aware replies (from Arya): the user's name and their common needs.
  if (/(what is your name|who are you)/.test(last) && profile?.name) {
    return [
      s(1, `My name is ${profile.name}.`, 'happy'),
      s(2, `I am ${profile.name}.`, 'neutral'),
      s(3, "I'd rather not say right now.", 'serious'),
    ];
  }

  if (
    /(do you need anything|what do you need|can i get you something)/.test(last) &&
    profile?.common_needs?.length
  ) {
    return [
      s(1, `Yes, please ${profile.common_needs[0]}.`, 'neutral'),
      s(2, "No, I'm okay for now.", 'neutral'),
      s(3, 'Just some water, thanks.', 'happy'),
    ];
  }

  // Celebratory news or accomplishments (e.g. "you got a job")
  if (/(job|congrat|promot|hired|offer|passed|won|awesome|great news|good news)/.test(last)) {
    if (activeEmotion === 'happy' || activeEmotion === 'excited') {
      return [
        s(1, 'Congrats thats awesome!', 'happy'),
        s(2, "I'm so thrilled and excited!", 'happy'),
        s(3, 'Thank you so much!', 'happy'),
        s(4, 'When do I start?', 'neutral'),
      ];
    }
    if (activeEmotion === 'serious') {
      return [
        s(1, 'Are you serious? Tell me more.', 'serious'),
        s(2, 'What are the details?', 'neutral'),
        s(3, 'Thank you for letting me know.', 'neutral'),
      ];
    }
    if (activeEmotion === 'joking') {
      return [
        s(1, "Are you sure they didn't mix me up?", 'joking'),
        s(2, 'Drinks are on you then!', 'joking'),
        s(3, "That's awesome!", 'happy'),
      ];
    }
  }

  if (/(pain|hurt|uncomfortable)/.test(last)) {
    if (activeEmotion === 'sad') {
      return [
        s(1, 'It really hurts today.', 'sad'),
        s(2, "I'm having a rough time.", 'sad'),
        s(3, 'Please adjust my pillow.', 'neutral'),
      ];
    }
    return [
      s(1, 'Yes, it hurts a lot right now.', 'serious'),
      s(2, 'A little, but I can manage.', 'neutral'),
      s(3, 'Please adjust my pillow.', 'neutral'),
    ];
  }

  if (/(hungry|eat|food|dinner|lunch)/.test(last)) {
    if (activeEmotion === 'happy' || activeEmotion === 'excited') {
      return [
        s(1, "Yes, I'd love something to eat!", 'happy'),
        s(2, 'That sounds delicious!', 'happy'),
        s(3, 'Maybe a little later.', 'neutral'),
      ];
    }
    return [
      s(1, "Yes, I'd love something to eat!", 'happy'),
      s(2, 'Maybe a little later.', 'neutral'),
      s(3, 'Anything but soup, please.', 'joking'),
    ];
  }

  if (/(how are you|feeling|how do you feel)/.test(last)) {
    if (activeEmotion === 'happy' || activeEmotion === 'excited') {
      return [
        s(1, "I'm feeling good today.", 'happy'),
        s(2, 'Really happy right now!', 'happy'),
        s(3, "Better now that you're here.", 'happy'),
      ];
    }
    if (activeEmotion === 'sad') {
      return [
        s(1, 'A bit tired, honestly.', 'sad'),
        s(2, 'Not feeling great today.', 'sad'),
        s(3, "I'm hanging in there.", 'neutral'),
      ];
    }
    if (activeEmotion === 'joking') {
      return [
        s(1, "Can't complain, nobody listens anyway!", 'joking'),
        s(2, 'Surviving, one blink at a time.', 'joking'),
        s(3, 'Doing alright today.', 'neutral'),
      ];
    }
  }

  if (activeEmotion === 'happy' || activeEmotion === 'excited') {
    return [
      s(1, 'That sounds wonderful!', 'happy'),
      s(2, 'Yes, absolutely!', 'happy'),
      s(3, "I'm so glad.", 'happy'),
      s(4, 'I love you.', 'happy'),
    ];
  }
  if (activeEmotion === 'sad') {
    return [
      s(1, "I'm sorry to hear that.", 'sad'),
      s(2, 'That makes me sad.', 'sad'),
      s(3, 'I need a moment.', 'neutral'),
      s(4, 'No, thank you.', 'neutral'),
    ];
  }
  if (activeEmotion === 'joking') {
    return [
      s(1, "Haha, you can't be serious!", 'joking'),
      s(2, 'Very funny.', 'joking'),
      s(3, 'Nice try!', 'joking'),
      s(4, 'Yes.', 'neutral'),
    ];
  }

  return [
    s(1, 'Yes.', 'neutral'),
    s(2, 'No, thank you.', 'neutral'),
    s(3, 'Can you say that again?', 'neutral'),
    s(4, 'I love you.', 'happy'),
  ];
};
