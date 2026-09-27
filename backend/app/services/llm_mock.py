"""Canned suggestions used when there is no API key (or MOCK_LLM=1).

Lets everyone develop the UI without spending money or needing a key.
"""

from app.schemas import ConversationTurn, Emotion, Suggestion, UserProfile


def _s(i: int, text: str, tone: str) -> Suggestion:
    return Suggestion(id=f"mock-{i}", text=text, tone=tone)  # type: ignore[arg-type]


def mock_suggestions(
    history: list[ConversationTurn],
    mood: Emotion | None = None,
    reaction: Emotion | None = None,
    profile: UserProfile | None = None,
) -> list[Suggestion]:
    last = next((t.text.lower() for t in reversed(history) if t.speaker == "partner"), "")
    active_emotion = reaction or mood or "neutral"

    # Celebratory news or accomplishments (e.g. "you got a job")
    if any(
        w in last
        for w in (
            "job",
            "congrat",
            "promot",
            "hired",
            "offer",
            "passed",
            "won",
            "awesome",
            "great news",
            "good news",
        )
    ):
        if active_emotion in ("happy", "excited"):
            return [
                _s(1, "Congrats thats awesome!", "happy"),
                _s(2, "I'm so thrilled and excited!", "happy"),
                _s(3, "Thank you so much!", "happy"),
                _s(4, "When do I start?", "neutral"),
            ]
        if active_emotion == "serious":
            return [
                _s(1, "Are you serious? Tell me more.", "serious"),
                _s(2, "What are the details?", "neutral"),
                _s(3, "Thank you for letting me know.", "neutral"),
            ]
        if active_emotion == "joking":
            return [
                _s(1, "Are you sure they didn't mix me up?", "joking"),
                _s(2, "Drinks are on you then!", "joking"),
                _s(3, "That's awesome!", "happy"),
            ]

    if any(w in last for w in ("what is your name", "who are you")):
        if profile and profile.name:
            return [
                _s(1, f"My name is {profile.name}.", "happy"),
                _s(2, f"I am {profile.name}.", "neutral"),
                _s(3, "I'd rather not say right now.", "serious"),
            ]

    if any(
        w in last for w in ("do you need anything", "what do you need", "can i get you something")
    ):
        if profile and profile.common_needs:
            need = profile.common_needs[0]
            return [
                _s(1, f"Yes, please {need}.", "neutral"),
                _s(2, "No, I'm okay for now.", "neutral"),
                _s(3, "Just some water, thanks.", "happy"),
            ]

    if any(w in last for w in ("pain", "hurt", "uncomfortable")):
        if active_emotion == "sad":
            return [
                _s(1, "It really hurts today.", "sad"),
                _s(2, "I'm having a rough time.", "sad"),
                _s(3, "Please adjust my pillow.", "neutral"),
            ]
        return [
            _s(1, "Yes, it hurts a lot right now.", "serious"),
            _s(2, "A little, but I can manage.", "neutral"),
            _s(3, "Please adjust my pillow.", "neutral"),
        ]

    if any(w in last for w in ("hungry", "eat", "food", "dinner", "lunch")):
        if active_emotion in ("happy", "excited"):
            return [
                _s(1, "Yes, I'd love something to eat!", "happy"),
                _s(2, "That sounds delicious!", "happy"),
                _s(3, "Maybe a little later.", "neutral"),
            ]
        return [
            _s(1, "Yes, I'd love something to eat!", "happy"),
            _s(2, "Maybe a little later.", "neutral"),
            _s(3, "Anything but soup, please.", "joking"),
        ]

    if any(w in last for w in ("how are you", "feeling", "how do you feel")):
        if active_emotion in ("happy", "excited"):
            return [
                _s(1, "I'm feeling good today.", "happy"),
                _s(2, "Really happy right now!", "happy"),
                _s(3, "Better now that you're here.", "happy"),
            ]
        if active_emotion == "sad":
            return [
                _s(1, "A bit tired, honestly.", "sad"),
                _s(2, "Not feeling great today.", "sad"),
                _s(3, "I'm hanging in there.", "neutral"),
            ]
        if active_emotion == "joking":
            return [
                _s(1, "Can't complain, nobody listens anyway!", "joking"),
                _s(2, "Surviving, one blink at a time.", "joking"),
                _s(3, "Doing alright today.", "neutral"),
            ]

    if active_emotion in ("happy", "excited"):
        return [
            _s(1, "That sounds wonderful!", "happy"),
            _s(2, "Yes, absolutely!", "happy"),
            _s(3, "I'm so glad.", "happy"),
            _s(4, "I love you.", "happy"),
        ]
    if active_emotion == "sad":
        return [
            _s(1, "I'm sorry to hear that.", "sad"),
            _s(2, "That makes me sad.", "sad"),
            _s(3, "I need a moment.", "neutral"),
            _s(4, "No, thank you.", "neutral"),
        ]
    if active_emotion == "joking":
        return [
            _s(1, "Haha, you can't be serious!", "joking"),
            _s(2, "Very funny.", "joking"),
            _s(3, "Nice try!", "joking"),
            _s(4, "Yes.", "neutral"),
        ]

    return [
        _s(1, "Yes.", "neutral"),
        _s(2, "No, thank you.", "neutral"),
        _s(3, "Can you say that again?", "neutral"),
        _s(4, "I love you.", "happy"),
    ]
