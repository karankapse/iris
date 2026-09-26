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
offer at least one clear, easy direct option."""


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
    history: list[ConversationTurn],
    mood: Emotion | None,
    profile: UserProfile | None = None,
    reaction: Emotion | None = None,
) -> str:
    lines = [f"{'Partner' if t.speaker == 'partner' else 'Me'}: {t.text}" for t in history]
    context = []
    if reaction:
        context.append(f"My detected emotional reaction to what was just said: {reaction}.")
    if mood:
        context.append(f"My persistent mood setting: {mood}.")
    if not context:
        context.append("I have no specific mood or reaction detected (neutral).")

    context_str = " ".join(context)
    return (
        _format_profile(profile)
        + "Conversation so far:\n"
        + "\n".join(lines)
        + f"\n\n{context_str}\n"
        + "Use the connotation of what the partner said and my emotional reaction "
        + "to suggest my next replies."
    )


def generate_suggestions(
    settings: Settings,
    history: list[ConversationTurn],
    mood: Emotion | None,
    profile: UserProfile | None = None,
    reaction: Emotion | None = None,
) -> list[Suggestion]:
    if settings.use_mock_llm:
        return mock_suggestions(history, mood=mood, reaction=reaction)

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
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
                "content": _format_history(history, mood, profile, reaction),
            }
        ],
        output_format=_Drafts,
    )
    # No parsed output means Claude stopped early (e.g. stop_reason "refusal" or "max_tokens").
    # Show the canned replies rather than failing the whole request.
    if response.parsed_output is None or not response.parsed_output.replies:
        logger.warning("Claude returned no usable replies (stop_reason=%s)", response.stop_reason)
        return mock_suggestions(history, mood=mood, reaction=reaction)
    drafts = response.parsed_output.replies[:4]  # the UI never shows more than 4 options
    return [Suggestion(id=str(uuid.uuid4()), text=d.text, tone=d.tone) for d in drafts]
