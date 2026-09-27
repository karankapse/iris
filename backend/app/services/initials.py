"""First-letter typing: the person types only the first letter of each word ("i w w") and we
guess the sentence ("I want water"). These helpers check that a guess really fits the letters."""

import re

# Everyday replies for when there is no AI (mock mode), matched by their first letters.
COMMON_PHRASES = [
    "I want water",
    "I need help",
    "I am tired",
    "I love you",
    "Thank you",
    "Yes please",
    "No thank you",
    "I am in pain",
    "I want to sleep",
    "Call my family",
    "I am cold",
    "I am hot",
    "Turn on the TV",
    "I need the bathroom",
    "Please adjust my pillow",
    "I am hungry",
    "What time is it",
    "I want to go outside",
    "I feel sick",
    "Not right now",
]


def words(text: str) -> list[str]:
    """Words as the person would count them ("I'm" and "don't" are one word each, also when
    written with a typographic apostrophe: "I’m")."""
    return re.findall(r"[A-Za-z0-9]+(?:['\u2019][A-Za-z]+)?", text)


def initials_of(text: str) -> str:
    return "".join(w[0].lower() for w in words(text))


def normalize(initials: str) -> str:
    return re.sub(r"[^a-z0-9]", "", initials.lower())


def fits(text: str, initials: str) -> bool:
    """True if `text` has exactly one word per letter, each starting with that letter."""
    return initials_of(text) == normalize(initials)
