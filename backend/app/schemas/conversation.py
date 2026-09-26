from pydantic import BaseModel, Field

from .common import Emotion, Speaker


class ConversationTurn(BaseModel):
    speaker: Speaker
    text: str


class UserProfile(BaseModel):
    name: str | None = Field(default=None, description="The user's name")
    relationships: dict[str, str] | None = Field(
        default=None, description="Key-value mapping of names to relationships (e.g. 'Sarah': 'wife')"
    )
    common_needs: list[str] | None = Field(
        default=None, description="Things the user often needs (e.g. 'water', 'adjust pillow')"
    )


class SuggestionsRequest(BaseModel):
    history: list[ConversationTurn] = Field(
        description="Oldest first; last turn is usually the partner"
    )
    mood: Emotion | None = Field(
        default=None, description="The user's persistent mood setting, if any"
    )
    profile: UserProfile | None = Field(
        default=None, description="The user's profile context (name, relationships, common needs)"
    )


class Suggestion(BaseModel):
    id: str
    text: str = Field(description="A short reply the user could say, in first person")
    tone: Emotion = Field(description="The emotional tone this reply is best spoken with")


class SuggestionsResponse(BaseModel):
    suggestions: list[Suggestion]
