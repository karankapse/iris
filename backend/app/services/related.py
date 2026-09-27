"""Is new speech part of what the partner was just saying, or something else in the room?

Used while replies are being prepared: a follow-up ("Are you hungry?" ... "We have soup.")
should change the replies; the TV or another conversation should not.
"""

import logging

from pydantic import BaseModel

from app.config import Settings
from app.services.conversation_memory import keywords
from app.services.llm import claude

logger = logging.getLogger(__name__)

RELATED_PROMPT = """\
Someone is talking to a person who cannot speak. While that person's replies were being \
prepared, the microphone heard more speech. Decide whether the NEW speech continues what the \
partner was saying to them (a follow-up, an added detail, a rephrased question) or is \
unrelated (a TV, a radio, someone else's conversation, a new topic said to someone else).
Answer related=true only if the new speech belongs to the same turn."""


class _Verdict(BaseModel):
    related: bool


def keyword_related(previous: str, new: str) -> bool:
    """Offline guess: the two share at least one content word."""
    return bool(keywords(previous) & keywords(new))


def is_related(settings: Settings, previous: str, new: str) -> bool:
    if settings.use_mock_llm:
        return keyword_related(previous, new)
    client = claude(settings.anthropic_api_key)
    response = client.messages.parse(
        model=settings.anthropic_fast_model,
        max_tokens=64,
        system=RELATED_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"What the partner said:\n{previous}\n\nNew speech:\n{new}",
            }
        ],
        output_format=_Verdict,
    )
    if response.parsed_output is None:
        logger.warning("No related verdict (stop_reason=%s)", response.stop_reason)
        return keyword_related(previous, new)
    return response.parsed_output.related
