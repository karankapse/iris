from typing import Literal

from pydantic import BaseModel, Field

from .common import Emotion, Speaker
from .profile import UserProfile


class ConversationTurn(BaseModel):
    speaker: Speaker
    text: str


class FaceReaction(BaseModel):
    """The user's face while reacting to what was just said (not just one label)."""

    scores: dict[Emotion, float] = Field(
        default_factory=dict,
        description="Share of the reaction window per emotion, weighted by confidence (0..1)",
    )
    peak: Emotion | None = Field(default=None, description="Strongest non-neutral expression")
    confidence: float = Field(default=0, ge=0, le=1, description="How sure the peak was")


class ConversationEmotion(BaseModel):
    """How this moment feels, judged from the partner's words AND the user's face."""

    emotion: Emotion
    confidence: float = Field(ge=0, le=1)
    reason: str = Field(default="", description="Short: why (and any words/face disagreement)")
    source: Literal["face", "words", "face + words"] = "face + words"


class SuggestionsRequest(BaseModel):
    user_id: str = Field(default="local-user", description="Whose conversation memory to use")
    history: list[ConversationTurn] = Field(
        description="Oldest first; last turn is usually the partner"
    )
    mood: Emotion | None = Field(
        default=None, description="The user's persistent mood setting, if any"
    )
    profile: UserProfile | None = Field(
        default=None, description="Who the user is, so replies feel personal"
    )
    reaction: Emotion | None = Field(
        default=None,
        description="The user's immediate emotional reaction / facial expression to what was said",
    )
    face_reaction: FaceReaction | None = Field(
        default=None, description="The full face reading behind `reaction`"
    )


class ExpandRequest(BaseModel):
    """First-letter typing: guess the sentence from the first letter of each word."""

    initials: str = Field(min_length=1, max_length=30, description='e.g. "iww" for "I want water"')
    history: list[ConversationTurn] = Field(default_factory=list)
    mood: Emotion | None = None
    profile: UserProfile | None = None
    user_id: str = "local-user"


class RelatedRequest(BaseModel):
    previous: str = Field(description="What the partner said this turn so far")
    new: str = Field(description="Speech heard while the replies were being prepared")


class RelatedResponse(BaseModel):
    related: bool = Field(description="True if the new speech continues the same turn")


class Suggestion(BaseModel):
    id: str
    text: str = Field(description="A short reply the user could say, in first person")
    tone: Emotion = Field(description="The emotional tone this reply is best spoken with")


class SuggestionsResponse(BaseModel):
    suggestions: list[Suggestion]
    conversation_emotion: ConversationEmotion | None = None
