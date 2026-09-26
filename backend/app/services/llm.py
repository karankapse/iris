"""Asks Claude for 3-4 short suggested replies, as structured JSON.

We use the SDK's `messages.parse()` with a Pydantic model: the API is constrained to return
JSON matching the schema, and the SDK validates it for us.
"""

import uuid

import anthropic
from pydantic import BaseModel

from app.config import Settings
from app.schemas import ConversationTurn, Emotion, Suggestion, UserProfile
from app.services.llm_mock import mock_suggestions

SYSTEM_PROMPT = """\
You help a person who cannot speak or move (for example, someone with ALS or locked-in \
syndrome) reply to the people around them. They choose a reply using only their eyes, so \
every word costs them effort.

Write 3 or 4 possible replies the person might want to say next, in the first person.
- Keep each reply very short: usually under 12 words, never more than 20.
- Make the replies meaningfully different from each other (e.g. yes / no / a question / \
an emotional response), so one of them is likely right.
- Match the way a real person would talk. No emojis.
- Pay attention to my previous replies in the conversation history. Let my past choices influence the phrasing and style of your new suggestions.
- For each reply choose the emotional tone it is best spoken with: one of neutral, happy, \
sad, joking, serious.
- If the person has a current mood setting, lean the replies toward it, but still offer \
at least one clear yes/no style option."""


class _Draft(BaseModel):
    text: str
    tone: Emotion


class _Drafts(BaseModel):
    replies: list[_Draft]


def _format_history(
    history: list[ConversationTurn], mood: Emotion | None, profile: UserProfile | None
) -> str:
    # Trim history to the last 10 messages so long conversations don't exceed context window
    trimmed = history[-10:] if len(history) > 10 else history

    lines = [f"{'Partner' if t.speaker == 'partner' else 'Me'}: {t.text}" for t in trimmed]
    
    parts = ["Context about me:"]
    if profile:
        if profile.name:
            parts.append(f"- My name: {profile.name}")
        if profile.relationships:
            rels = ", ".join(f"{name} ({rel})" for name, rel in profile.relationships.items())
            parts.append(f"- People I know: {rels}")
        if profile.common_needs:
            parts.append(f"- Common things I might need: {', '.join(profile.common_needs)}")
    else:
        parts.append("- (No user profile provided)")
        
    parts.append(f"- My current mood setting: {mood if mood else 'none'}.")
    
    return (
        "\n".join(parts)
        + "\n\nConversation so far:\n"
        + "\n".join(lines)
        + "\n\nSuggest my next replies."
    )


def generate_suggestions(
    settings: Settings,
    history: list[ConversationTurn],
    mood: Emotion | None,
    profile: UserProfile | None = None,
) -> list[Suggestion]:
    if settings.use_mock_llm:
        return mock_suggestions(history, profile)

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
    drafts = response.parsed_output.replies[:4]  # the UI never shows more than 4 options
    return [Suggestion(id=str(uuid.uuid4()), text=d.text, tone=d.tone) for d in drafts]
