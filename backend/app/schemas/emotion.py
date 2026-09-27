from typing import Literal

from pydantic import BaseModel, Field

from .common import Emotion


class EmotionSample(BaseModel):
    label: Emotion
    features: list[float] = Field(description="Same order as `feature_names` in the request")
    source: Literal["calibration", "feedback"] = "calibration"


class SamplesRequest(BaseModel):
    user_id: str
    feature_names: list[str]
    samples: list[EmotionSample]


class TrainRequest(BaseModel):
    user_id: str


class EmotionModel(BaseModel):
    """A trained logistic-regression model, exported so the browser can run it locally.

    Prediction in the browser:
        x_scaled = (x - means) / scales
        logits[c] = sum_j(coef[c][j] * x_scaled[j]) + intercept[c]
        probabilities = softmax(logits)
    """

    user_id: str
    feature_names: list[str]
    classes: list[Emotion]
    means: list[float]
    scales: list[float]
    coef: list[list[float]] = Field(description="shape: [len(classes)][len(feature_names)]")
    intercept: list[float]
    n_samples: int
    # How good it is, measured on whole recordings the model did NOT train on.
    accuracy: float | None = Field(
        default=None, description="Average per-emotion accuracy on held-out recordings"
    )
    per_class_accuracy: dict[Emotion, float] = Field(default_factory=dict)
    advice: list[str] = Field(
        default_factory=list, description='e.g. "sad needs more examples (record it again)"'
    )
