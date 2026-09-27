import json
from pathlib import Path

from pydantic import BaseModel, Field

_DEFAULTS = Path(__file__).resolve().parents[3] / "shared" / "default-phrases.json"


def default_phrases() -> list[str]:
    """The starting quick phrases, shared with the frontend (shared/default-phrases.json)."""
    return json.loads(_DEFAULTS.read_text())


class UserProfile(BaseModel):
    """Optional info that makes suggestions feel personal, plus the quick-access phrases."""

    name: str = ""
    relationships: list[str] = Field(default_factory=list, description='e.g. "daughter Maya"')
    interests: list[str] = Field(default_factory=list)
    common_needs: list[str] = Field(default_factory=list, description='e.g. "water", "pillow"')
    phrases: list[str] = Field(default_factory=default_phrases, description="Quick-access phrases")
