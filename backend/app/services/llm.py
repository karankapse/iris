"""Asks Claude for 3-4 short suggested replies, as structured JSON.

We use the SDK's `messages.parse()` with a Pydantic model: the API is constrained to return
JSON matching the schema, and the SDK validates it for us.
"""

import uuid

import anthropic
from pydantic import BaseModel

from app.config import Settings
from app.schemas import ConversationTurn, Emotion, Suggestion
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
- For each reply choose the emotional tone it is best spoken with: one of neutral, happy, \
sad, joking, serious.
- If the person has a current mood setting, lean the replies toward it, but still offer \
at least one clear yes/no style option."""


class _Draft(BaseModel):
    text: str
    tone: Emotion


class _Drafts(BaseModel):
    replies: list[_Draft]


def _format_history(history: list[ConversationTurn], mood: Emotion | None) -> str:
    lines = [f"{'Partner' if t.speaker == 'partner' else 'Me'}: {t.text}" for t in history]
    mood_line = f"My current mood setting: {mood}." if mood else "I have no mood setting."
    return (
        "Conversation so far:\n" + "\n".join(lines) + f"\n\n{mood_line}\nSuggest my next replies."
    )


def generate_suggestions(
    settings: Settings, history: list[ConversationTurn], mood: Emotion | None
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
        messages=[{"role": "user", "content": _format_history(history, mood)}],
        output_format=_Drafts,
    )
    drafts = response.parsed_output.replies[:4]  # the UI never shows more than 4 options
    return [Suggestion(id=str(uuid.uuid4()), text=d.text, tone=d.tone) for d in drafts]
