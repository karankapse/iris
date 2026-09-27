"""How does this moment feel? Combine what the partner said with the user's face.

Claude does this inside the suggestion call (see llm.py). These rules are the offline version
(mock mode) and the fallback when Claude doesn't return a judgement.
  - A confident (>= FACE_TRUST), non-neutral face is the user's real reaction: it wins.
  - Otherwise the connotation of the words decides.
"""

import re

from app.schemas import ConversationEmotion, Emotion, FaceReaction

FACE_TRUST = 0.6

# Crude connotation cues, most specific first.
WORD_CUES: list[tuple[Emotion, tuple[str, ...]]] = [
    (
        "excited",
        ("congrat", "you got", "we won", "great news", "good news", "promot", "hired", "engaged"),
    ),
    (
        "sad",
        ("passed away", "died", "sorry", "bad news", "miss you", "hospital", "lost", "funeral"),
    ),
    ("serious", ("doctor", "pain", "hurt", "medicine", "important", "decide", "worried", "bill")),
    ("joking", ("joke", "kidding", "funny", "haha", "lol", "silly", "guess what")),
    ("happy", ("love", "beautiful", "visit", "birthday", "thank", "great", "nice", "fun")),
]


def words_emotion(text: str) -> Emotion | None:
    t = re.sub(r"\s+", " ", text.lower().replace("’", "'"))
    for emotion, cues in WORD_CUES:
        if any(c in t for c in cues):
            return emotion
    return None


def _face_label(
    face: FaceReaction | None, reaction: Emotion | None
) -> tuple[Emotion | None, float]:
    if face and face.peak:
        return face.peak, face.confidence
    if reaction and reaction != "neutral":
        return reaction, FACE_TRUST  # an older client sends only the label
    return None, 0.0


def combine(
    partner_text: str, face: FaceReaction | None, reaction: Emotion | None = None
) -> ConversationEmotion:
    felt, sure = _face_label(face, reaction)
    said = words_emotion(partner_text)
    if felt and felt != "neutral" and sure >= FACE_TRUST:
        if said and said != felt:
            reason = f"your face looked {felt}, though the words sounded {said}"
            return ConversationEmotion(emotion=felt, confidence=sure, reason=reason, source="face")
        both = said == felt
        return ConversationEmotion(
            emotion=felt,
            confidence=min(1.0, sure + (0.15 if both else 0)),
            reason=f"your face looked {felt}" + (" and the words agree" if both else ""),
            source="face + words" if both else "face",
        )
    if said:
        return ConversationEmotion(
            emotion=said, confidence=0.6, reason=f"the words sound {said}", source="words"
        )
    return ConversationEmotion(
        emotion="neutral", confidence=0.5, reason="nothing stood out", source="face + words"
    )
