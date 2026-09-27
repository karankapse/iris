"""Parsing and validating a "speak this" request from the frontend.

The frontend sends JSON over a LiveKit RPC call: {"text": "...", "tone": "happy", "speed": 1.0}
We speak EXACTLY that text. No language model is involved and nothing is rewritten.
"""

import json

from pydantic import BaseModel, Field, ValidationError, field_validator

from iris_agent.tone_map import ToneMap

MAX_TEXT_CHARS = 500  # replies are short; this also keeps the RPC payload small


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    tone: str
    speed: float = Field(default=1.0, ge=0.5, le=2.0)

    @field_validator("text")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("text is empty")
        return v


def parse_speak_request(payload: str, tone_map: ToneMap) -> SpeakRequest:
    """Turn the RPC payload into a checked request. Raises ValueError with a readable message."""
    try:
        request = SpeakRequest.model_validate(json.loads(payload))
    except json.JSONDecodeError as e:
        raise ValueError(f"The speak request is not valid JSON: {e.msg}") from e
    except ValidationError as e:
        problems = "; ".join(
            f"{'.'.join(map(str, err['loc']))}: {err['msg']}" for err in e.errors()
        )
        raise ValueError(f"Invalid speak request ({problems})") from e
    if request.tone not in tone_map.tones:
        raise ValueError(f"Unknown tone {request.tone!r}. Known tones: {sorted(tone_map.tones)}")
    return request
