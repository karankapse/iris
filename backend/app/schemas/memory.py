from pydantic import BaseModel, Field

from .common import Emotion


class ExchangeLog(BaseModel):
    """One moment of conversation, logged when a reply is spoken."""

    user_id: str = "local-user"
    utterance_id: str
    partner_text: str = Field(description="What the partner had just said")
    detected_emotion: Emotion | None = Field(
        default=None, description="What the user's face showed right after the partner spoke"
    )
    emotion_confidence: float | None = Field(default=None, ge=0, le=1)
    mood: Emotion | None = Field(default=None, description="The user's mood setting")
    reply_text: str
    reply_tone: Emotion


class MemoryEntry(BaseModel):
    partner_text: str
    detected_emotion: Emotion | None
    reply_text: str
    reply_tone: Emotion
    tone_ok: bool | None
    created_at: str


class MemoryResponse(BaseModel):
    count: int
    entries: list[MemoryEntry] = Field(description="Newest first")
