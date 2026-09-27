"""Asks Claude for 3-4 short suggested replies, as structured JSON.

We use the SDK's `messages.parse()` with a Pydantic model: the API is constrained to return
JSON matching the schema, and the SDK validates it for us.
"""

import logging
import re
import uuid
from typing import Literal

import anthropic
from pydantic import BaseModel

from app.config import Settings
from app.schemas import (
    ConversationEmotion,
    ConversationTurn,
    Emotion,
    FaceReaction,
    Suggestion,
    UserProfile,
)
from app.services.initials import COMMON_PHRASES, fits, normalize
from app.services.llm_mock import mock_suggestions
from app.services.moment_emotion import combine

logger = logging.getLogger(__name__)

# How many recent conversation turns are sent to Claude.
MAX_HISTORY_TURNS = 10

SYSTEM_PROMPT = """\
You help a person who cannot speak or move (for example, someone with ALS or locked-in \
syndrome) reply to the people around them. They choose a reply using only their eyes, so \
every word costs them effort.

Write 3 or 4 possible replies the person might want to say next, in the first person.
- Reply to what the partner said LAST. Earlier lines and past moments are only background: \
don't answer an earlier question again, go back to an older topic, or repeat what I already said.
- Keep each reply very short: usually under 12 words, never more than 20.
- Make the replies meaningfully different from each other (e.g. yes / no / a question / \
an emotional response), so one of them is likely right.
- Match the way a real person would talk. No emojis.
- Pay attention to my previous replies in the conversation history. Let my past choices \
influence the phrasing and style of your new suggestions.
- For each reply choose the emotional tone it is best spoken with: one of neutral, happy, \
sad, excited, joking, serious.
- CONNOTATION AND EMOTIONAL REACTION: Critically analyze the connotation of what the partner \
just said (e.g., celebration, sharing good/bad news, question, distress, teasing, greeting) \
in combination with the user's active emotional reaction / facial expression (e.g., happy, \
sad, joking, serious, excited).
- For example, if the partner shares good news or says "you got a job" and the user's reaction \
is happy or excited, provide enthusiastic replies celebrating the news (e.g. "Congrats that's \
awesome!", "I'm so thrilled!", "Thank you so much!").
- If the user's reaction is serious, offer grounded, clarifying, or earnest replies.
- If the user's reaction is sad, offer vulnerable, empathetic, or somber replies.
- If the user's reaction is joking, offer playful, teasing, or humorous replies.
- If the person has a current mood setting or reaction, lean the replies toward it, but still \
offer at least one clear, easy direct option.

HOW THIS MOMENT FEELS (conversation_emotion): judge it from BOTH the connotation of what the \
partner said AND my face while I listened.
- My face is my real reaction. If the face reading is confident (0.6 or more) and not neutral, \
trust the face.
- If my face is neutral or unsure, decide from the connotation of the words.
- If the words and my face disagree (for example good news but a sad face), say so in `reason` \
and include at least one reply for each reading.
- `reason` is a few words. `source` is "face", "words" or "face + words"."""


class _Draft(BaseModel):
    text: str
    tone: Emotion


class _Feel(BaseModel):
    emotion: Emotion
    confidence: float
    reason: str
    source: Literal["face", "words", "face + words"]


class _Drafts(BaseModel):
    replies: list[_Draft]
    conversation_emotion: _Feel | None = None


def _format_profile(profile: UserProfile | None) -> str:
    """A few lines about the user, so replies sound like them (empty if nothing is filled in)."""
    if profile is None:
        return ""
    parts = []
    if profile.name:
        parts.append(f"My name is {profile.name}.")
    if profile.relationships:
        parts.append("People in my life: " + "; ".join(profile.relationships) + ".")
    if profile.interests:
        parts.append("My interests: " + ", ".join(profile.interests) + ".")
    if profile.common_needs:
        parts.append("Things I often need: " + ", ".join(profile.common_needs) + ".")
    return ("About me: " + " ".join(parts) + "\n\n") if parts else ""


def _format_history(
    history: list[ConversationTurn],
    mood: Emotion | None,
    profile: UserProfile | None = None,
    reaction: Emotion | None = None,
    memory: str = "",
    face: FaceReaction | None = None,
) -> str:
    # Only the last turns go to Claude, so long conversations stay fast and cheap (from Arya).
    recent = history[-MAX_HISTORY_TURNS:]
    lines = [f"{'Partner' if t.speaker == 'partner' else 'Me'}: {t.text}" for t in recent]
    context = []
    if reaction:
        context.append(f"My detected emotional reaction to what was just said: {reaction}.")
    if face:
        shares = ", ".join(
            f"{e} {v:.2f}" for e, v in sorted(face.scores.items(), key=lambda kv: -kv[1]) if v > 0
        )
        peak = f"; strongest: {face.peak} (confidence {face.confidence:.2f})" if face.peak else ""
        context.append(f"My face while listening: {shares or 'neutral'}{peak}.")
    if mood:
        context.append(f"My persistent mood setting: {mood}.")
    if not context:
        context.append("I have no specific mood or reaction detected (neutral).")

    context_str = " ".join(context)
    latest = _partner_text(recent)
    return (
        _format_profile(profile)
        + memory
        + "Conversation so far:\n"
        + "\n".join(lines)
        + (f'\n\nThe partner just said: "{latest}"' if latest else "")
        + f"\n\n{context_str}\n"
        + "Use the connotation of what the partner just said and my emotional reaction "
        + "to suggest my next replies to it."
    )


def generate_suggestions(
    settings: Settings,
    history: list[ConversationTurn],
    mood: Emotion | None,
    profile: UserProfile | None = None,
    reaction: Emotion | None = None,
    memory: str = "",
) -> list[Suggestion]:
    return generate_reply_bundle(settings, history, mood, profile, reaction, memory)[0]


_clients: dict[tuple, anthropic.Anthropic] = {}


def claude(api_key: str) -> anthropic.Anthropic:
    """One client per key, reused: each turn skips opening a new connection to Claude."""
    key = (anthropic.Anthropic, api_key)  # (the class too, so tests can swap in a fake)
    if key not in _clients:
        _clients[key] = anthropic.Anthropic(api_key=api_key)
    return _clients[key]


def _partner_text(history: list[ConversationTurn]) -> str:
    return next((t.text for t in reversed(history) if t.speaker == "partner"), "")


def generate_reply_bundle(
    settings: Settings,
    history: list[ConversationTurn],
    mood: Emotion | None,
    profile: UserProfile | None = None,
    reaction: Emotion | None = None,
    memory: str = "",
    face: FaceReaction | None = None,
) -> tuple[list[Suggestion], ConversationEmotion]:
    """Replies AND how the moment feels (words + face), from ONE Claude call."""
    rules = combine(_partner_text(history), face, reaction)
    if settings.use_mock_llm:
        # offline: lean the canned replies toward the combined feeling
        lean = rules.emotion if rules.emotion != "neutral" else reaction
        items = mock_suggestions(history, mood=mood, reaction=lean, profile=profile)
        return items, rules

    client = claude(settings.anthropic_api_key)
    response = client.messages.parse(
        model=settings.anthropic_model,
        max_tokens=1024,
        # Latency matters more than deep reasoning for 3 short replies.
        # (If you switch ANTHROPIC_MODEL to a model that always thinks, remove this line.)
        thinking={"type": "disabled"},
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": _format_history(history, mood, profile, reaction, memory, face),
            }
        ],
        output_format=_Drafts,
    )
    # No parsed output means Claude stopped early (e.g. stop_reason "refusal" or "max_tokens").
    # Show the canned replies rather than failing the whole request.
    if response.parsed_output is None or not response.parsed_output.replies:
        logger.warning("Claude returned no usable replies (stop_reason=%s)", response.stop_reason)
        return mock_suggestions(history, mood=mood, reaction=reaction, profile=profile), rules
    drafts = response.parsed_output.replies[:4]  # the UI never shows more than 4 options
    items = [Suggestion(id=str(uuid.uuid4()), text=d.text, tone=d.tone) for d in drafts]
    feel = response.parsed_output.conversation_emotion
    if feel is None:
        return items, rules
    return items, ConversationEmotion(
        emotion=feel.emotion,
        confidence=min(1.0, max(0.0, feel.confidence)),
        reason=feel.reason[:120],
        source=feel.source,
    )


# ---- first-letter typing -------------------------------------------------------------------

EXPAND_PROMPT = """\
You help a person who cannot speak or move (for example, someone with ALS or locked-in \
syndrome) reply to the people around them, using only their eyes. To save effort they type only \
the FIRST LETTER of each word they want to say, and you guess the sentence.

Rules for every guess:
- Exactly one word per letter, in the same order, each word starting with that letter. \
Contractions like "I'm" or "don't" count as one word.
- Use the conversation, what you know about me and how I usually feel to guess what I most \
likely mean.
- Give 3 or 4 different guesses, most likely first. Short, natural, first person. No emojis.
- For each guess choose the emotional tone it is best spoken with: one of neutral, happy, \
sad, excited, joking, serious."""


def expand_initials(
    settings: Settings,
    initials: str,
    history: list[ConversationTurn],
    mood: Emotion | None = None,
    profile: UserProfile | None = None,
    memory: str = "",
) -> list[Suggestion]:
    """Guess full replies from first letters. Guesses that don't fit the letters are dropped
    (unless nothing fits, then the closest ones are kept so the person still sees something)."""
    letters = normalize(initials)
    if not letters:
        return []
    if settings.use_mock_llm:
        return _mock_expansions(letters, profile)

    client = claude(settings.anthropic_api_key)
    response = client.messages.parse(
        model=settings.anthropic_model,
        max_tokens=1024,
        thinking={"type": "disabled"},  # latency matters: a guess after every letter
        system=EXPAND_PROMPT,
        messages=[
            {
                "role": "user",
                "content": _format_history(history, mood, profile, None, memory)
                + f"\n\nThe first letters I typed: {' '.join(letters.upper())}"
                + f" ({len(letters)} words). What do I want to say?",
            }
        ],
        output_format=_Drafts,
    )
    if response.parsed_output is None:
        logger.warning("Claude returned no guesses (stop_reason=%s)", response.stop_reason)
        return _mock_expansions(letters, profile)
    drafts = _dedupe(response.parsed_output.replies)
    good = [d for d in drafts if fits(d.text, letters)]
    chosen = (good or drafts[:2])[:4]
    return [Suggestion(id=str(uuid.uuid4()), text=d.text, tone=d.tone) for d in chosen]


def _mock_expansions(letters: str, profile: UserProfile | None) -> list[Suggestion]:
    """No AI: offer the person's quick phrases and some everyday phrases that fit the letters."""
    pool = [*(profile.phrases if profile else []), *COMMON_PHRASES]
    seen: set[str] = set()
    out = []
    for text in pool:
        if fits(text, letters) and text.lower() not in seen:
            seen.add(text.lower())
            out.append(Suggestion(id=f"mock-x{len(out)}", text=text, tone="neutral"))
    return out[:4]


def _dedupe(drafts: list[_Draft]) -> list[_Draft]:
    """Drop guesses that differ only in punctuation or case ("Yes, water" = "Yes water")."""
    seen: set[str] = set()
    out = []
    for d in drafts:
        key = " ".join(re.findall(r"[a-z0-9']+", d.text.lower().replace("\u2019", "'")))
        if key not in seen:
            seen.add(key)
            out.append(d)
    return out
