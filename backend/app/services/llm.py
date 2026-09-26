"""Asks an LLM for 3-4 short suggested replies, as structured JSON.

LLM_PROVIDER picks the backend: anthropic (default), ollama, or mock.

Claude: we use the SDK's `messages.parse()` with a Pydantic model: the API is constrained to
return JSON matching the schema, and the SDK validates it for us.

Ollama: we call its native chat endpoint with `format` set to the same Pydantic model's JSON
schema, so the output is constrained to valid replies and tones, then validate it. Any failure
(Ollama not running, bad JSON) falls back to canned replies.
"""

import logging
import uuid
from typing import Literal, get_args

import anthropic
import httpx
from pydantic import BaseModel, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.config import REPO_ROOT, Settings
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
- For each reply choose the emotional tone it is best spoken with: one of neutral, happy, \
sad, excited, joking, serious.
- If the person has a current mood setting, lean the replies toward it, but still offer \
at least one clear yes/no style option."""


logger = logging.getLogger(__name__)

OLLAMA_URL = "http://localhost:11434/api/chat"

# Small local models need the JSON shape spelled out; Claude gets it from the schema instead.
_TONES = "|".join(get_args(Emotion))
OLLAMA_JSON_INSTRUCTIONS = f"""

Respond with ONLY a JSON object of this exact shape, nothing else:
{{"replies": [{{"text": "<reply>", "tone": "<{_TONES}>"}}]}}"""


class _ProviderSettings(BaseSettings):
    """LLM provider selection, read from the environment / repo-root `.env` like `Settings`."""

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    llm_provider: Literal["anthropic", "ollama", "mock"] = "anthropic"
    ollama_model: str = "llama3.2:3b"


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


def _ollama_suggestions(
    model: str,
    history: list[ConversationTurn],
    mood: Emotion | None,
    profile: UserProfile | None = None,
) -> list[Suggestion]:
    try:
        response = httpx.post(
            OLLAMA_URL,
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT + OLLAMA_JSON_INSTRUCTIONS},
                    {"role": "user", "content": _format_history(history, mood, profile)},
                ],
                # Constrains generation to this schema, so small models can't invent tones.
                "format": _Drafts.model_json_schema(),
                "stream": False,
            },
            timeout=60.0,
        )
        response.raise_for_status()
        content = response.json()["message"]["content"]
        drafts = [d for d in _Drafts.model_validate_json(content).replies if d.text.strip()][:4]
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError, ValidationError):
        logger.exception("Ollama suggestions failed; falling back to canned replies")
        return mock_suggestions(history)
    if not drafts:
        return mock_suggestions(history)
    return [Suggestion(id=str(uuid.uuid4()), text=d.text, tone=d.tone) for d in drafts]


def generate_suggestions(
    settings: Settings,
    history: list[ConversationTurn],
    mood: Emotion | None,
    profile: UserProfile | None = None,
) -> list[Suggestion]:
    provider = _ProviderSettings()
    if provider.llm_provider == "mock":
        return mock_suggestions(history)
    if provider.llm_provider == "ollama" and not settings.mock_llm:
        return _ollama_suggestions(provider.ollama_model, history, mood, profile)

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
    drafts = response.parsed_output.replies[:4]  # the UI never shows more than 4 options
    return [Suggestion(id=str(uuid.uuid4()), text=d.text, tone=d.tone) for d in drafts]
