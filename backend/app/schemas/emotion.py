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
    accuracy: float | None = Field(
        default=None,
        description="Cross-validated accuracy (0.0 to 1.0), or None if not enough data to measure.",
    )
