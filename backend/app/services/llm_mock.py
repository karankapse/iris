"""Canned suggestions used when there is no API key (or MOCK_LLM=1).

Lets everyone develop the UI without spending money or needing a key.
"""

from app.schemas import ConversationTurn, Suggestion


def _s(i: int, text: str, tone: str) -> Suggestion:
    return Suggestion(id=f"mock-{i}", text=text, tone=tone)  # type: ignore[arg-type]


def mock_suggestions(history: list[ConversationTurn]) -> list[Suggestion]:
    last = next((t.text.lower() for t in reversed(history) if t.speaker == "partner"), "")

    if any(w in last for w in ("pain", "hurt", "uncomfortable")):
        return [
            _s(1, "Yes, it hurts a lot right now.", "serious"),
            _s(2, "A little, but I can manage.", "neutral"),
            _s(3, "Please adjust my pillow.", "neutral"),
        ]
    if any(w in last for w in ("hungry", "eat", "food", "dinner", "lunch")):
        return [
            _s(1, "Yes, I'd love something to eat!", "happy"),
            _s(2, "Maybe a little later.", "neutral"),
            _s(3, "Anything but soup, please.", "joking"),
        ]
    if any(w in last for w in ("how are you", "feeling", "how do you feel")):
        return [
            _s(1, "I'm feeling good today.", "happy"),
            _s(2, "A bit tired, honestly.", "sad"),
            _s(3, "Better now that you're here.", "happy"),
        ]
    return [
        _s(1, "Yes.", "neutral"),
        _s(2, "No, thank you.", "neutral"),
        _s(3, "Can you say that again?", "neutral"),
        _s(4, "I love you.", "happy"),
    ]
