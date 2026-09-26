"""Trains a small per-user emotion classifier from that user's own labelled examples.

Why logistic regression? It's tiny, trains in milliseconds on a few dozen samples, and its
weights are just numbers, so we can send them to the browser and predict there (no video,
and no per-frame network calls, leave the machine).
"""

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from app.schemas import EmotionModel


class NotEnoughData(ValueError):
    pass


def train_model(user_id: str, samples: list[dict]) -> EmotionModel:
    if not samples:
        raise NotEnoughData("No samples yet. Run the calibration first.")

    # Use the most recent feature layout; ignore older samples with a different layout.
    names = samples[-1]["feature_names"]
    usable = [s for s in samples if s["feature_names"] == names]

    labels = [s["label"] for s in usable]
    if len(set(labels)) < 2:
        raise NotEnoughData("Need examples of at least 2 different emotions to train.")

    x = np.array([s["features"] for s in usable], dtype=float)
    scaler = StandardScaler().fit(x)
    clf = LogisticRegression(max_iter=1000, class_weight="balanced")
    clf.fit(scaler.transform(x), labels)

    coef, intercept = clf.coef_, clf.intercept_
    if len(clf.classes_) == 2:
        # sklearn stores ONE weight row for 2 classes (sigmoid form). Convert it to the
        # 2-row softmax form so the browser only needs one prediction code path.
        coef = np.vstack([-coef[0] / 2, coef[0] / 2])
        intercept = np.array([-intercept[0] / 2, intercept[0] / 2])

    return EmotionModel(
        user_id=user_id,
        feature_names=names,
        classes=list(clf.classes_),
        means=scaler.mean_.tolist(),
        scales=scaler.scale_.tolist(),
        coef=coef.tolist(),
        intercept=intercept.tolist(),
        n_samples=len(usable),
    )
