"""Pydantic models = the source of truth for every HTTP payload.

The frontend's `src/shared/api.generated.ts` is generated from these (run `make gen-types`).
Do not edit the generated file by hand.
"""

from .common import Emotion, Speaker
from .conversation import ConversationTurn, Suggestion, SuggestionsRequest, SuggestionsResponse
from .emotion import EmotionModel, EmotionSample, SamplesRequest, TrainRequest
from .feedback import FeedbackRequest
from .profile import UserProfile, default_phrases

__all__ = [
    "ConversationTurn",
    "Emotion",
    "EmotionModel",
    "EmotionSample",
    "FeedbackRequest",
    "SamplesRequest",
    "Speaker",
    "Suggestion",
    "SuggestionsRequest",
    "SuggestionsResponse",
    "TrainRequest",
    "UserProfile",
    "default_phrases",
]
