from pydantic import BaseModel, Field

from .common import Emotion, Speaker


class ConversationTurn(BaseModel):
    speaker: Speaker
    text: str


class SuggestionsRequest(BaseModel):
    history: list[ConversationTurn] = Field(
        description="Oldest first; last turn is usually the partner"
    )
    mood: Emotion | None = Field(
        default=None, description="The user's persistent mood setting, if any"
    )


class Suggestion(BaseModel):
    id: str
    text: str = Field(description="A short reply the user could say, in first person")
    tone: Emotion = Field(description="The emotional tone this reply is best spoken with")


class SuggestionsResponse(BaseModel):
    suggestions: list[Suggestion]
