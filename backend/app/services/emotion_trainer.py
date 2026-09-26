"""Trains a small per-user emotion classifier from that user's own labelled examples.

Why logistic regression? It's tiny, trains in milliseconds on a few dozen samples, and its
weights are just numbers, so we can send them to the browser and predict there (no video,
and no per-frame network calls, leave the machine).
"""

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.preprocessing import StandardScaler
from collections import Counter

from app.schemas import EmotionModel


class NotEnoughData(ValueError):
    pass


def evaluate_model(samples: list[dict]) -> float | None:
    """Returns the cross-validated accuracy (0.0 to 1.0) of the model on this data.
    Returns None if there is not enough data to evaluate."""
    if not samples:
        return None

    names = samples[-1]["feature_names"]
    usable = [s for s in samples if s["feature_names"] == names]
    labels = [s["label"] for s in usable]
    
    if len(set(labels)) < 2:
        return None
        
    counts = Counter(labels)
    min_class_count = min(counts.values())
    
    # We need at least 2 samples per class to do the simplest cross-validation (2-fold)
    if min_class_count < 2:
        return None

    x = np.array([s["features"] for s in usable], dtype=float)
    
    # We don't fit the scaler outside the CV loop to avoid data leakage.
    # Instead, we use a Pipeline, but to keep it simple and match train_model exactly,
    # we can use sklearn's make_pipeline.
    from sklearn.pipeline import make_pipeline
    clf = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, class_weight="balanced"))
    
    cv = min(5, min_class_count)
    scores = cross_val_score(clf, x, labels, cv=StratifiedKFold(n_splits=cv, shuffle=True, random_state=42))
    return float(np.mean(scores))



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
        accuracy=evaluate_model(samples),
    )
