from typing import Literal

from pydantic import BaseModel, Field

from .common import Emotion


class FeedbackRequest(BaseModel):
    """One piece of feedback about a spoken reply.

    The user's eye yes/no and the partner's tap arrive at different moments, so both
    fields are optional; send whichever one you have. `utterance_id` ties them together.
    """

    user_id: str
    utterance_id: str
    reply_text: str
    spoken_tone: Emotion
    user_tone_ok: bool | None = Field(default=None, description="User's eye yes/no")
    partner_reaction: Literal["understood", "seemed_off"] | None = None
    feature_names: list[str] | None = None
    features: list[float] | None = Field(
        default=None, description="Face-feature snapshot taken when the tone was suggested"
    )
    feature_frames: list[list[float]] | None = Field(
        default=None,
        max_length=30,
        description="Face features from the reaction window (about 10 frames); preferred",
    )
