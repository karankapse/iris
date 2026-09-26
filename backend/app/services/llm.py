"""Asks Claude for 3-4 short suggested replies, as structured JSON.

We use the SDK's `messages.parse()` with a Pydantic model: the API is constrained to return
JSON matching the schema, and the SDK validates it for us.
"""

import logging
import uuid

import anthropic
from pydantic import BaseModel

from app.config import Settings
from app.schemas import ConversationTurn, Emotion, Suggestion, UserProfile
from app.services.llm_mock import mock_suggestions

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You help a person who cannot speak or move (for example, someone with ALS or locked-in \
syndrome) reply to the people around them. They choose a reply using only their eyes, so \
every word costs them effort.

Write 3 or 4 possible replies the person might want to say next, in the first person.
- Keep each reply very short: usually under 12 words, never more than 20.
- Make the replies meaningfully different from each other (e.g. yes / no / a question / \
an emotional response), so one of them is likely right.
- Match the way a real person would talk. No emojis.
- For each reply choose the emotional tone it is best spoken with: one of neutral, happy, \
sad, excited, joking, serious.
- If the person has a current mood setting, lean the replies toward it, but still offer \
at least one clear yes/no style option."""


class _Draft(BaseModel):
    text: str
    tone: Emotion


class _Drafts(BaseModel):
    replies: list[_Draft]


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
    history: list[ConversationTurn], mood: Emotion | None, profile: UserProfile | None = None
) -> str:
    lines = [f"{'Partner' if t.speaker == 'partner' else 'Me'}: {t.text}" for t in history]
    mood_line = f"My current mood setting: {mood}." if mood else "I have no mood setting."
    return (
        _format_profile(profile)
        + "Conversation so far:\n"
        + "\n".join(lines)
        + f"\n\n{mood_line}\nSuggest my next replies."
    )


def generate_suggestions(
    settings: Settings,
    history: list[ConversationTurn],
    mood: Emotion | None,
    profile: UserProfile | None = None,
) -> list[Suggestion]:
    if settings.use_mock_llm:
        return mock_suggestions(history)

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    response = client.messages.parse(
        model=settings.anthropic_model,
        max_tokens=1024,
        # Latency matters more than deep reasoning for 3 short replies.
        # (If you switch ANTHROPIC_MODEL to a model that always thinks, remove this line.)
        thinking={"type": "disabled"},
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _format_history(history, mood, profile)}],
        output_format=_Drafts,
    )
    # No parsed output means Claude stopped early (e.g. stop_reason "refusal" or "max_tokens").
    # Show the canned replies rather than failing the whole request.
    if response.parsed_output is None or not response.parsed_output.replies:
        logger.warning("Claude returned no usable replies (stop_reason=%s)", response.stop_reason)
        return mock_suggestions(history)
    drafts = response.parsed_output.replies[:4]  # the UI never shows more than 4 options
    return [Suggestion(id=str(uuid.uuid4()), text=d.text, tone=d.tone) for d in drafts]
