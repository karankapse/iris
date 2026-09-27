"""Trains a small per-user emotion classifier from that user's own labelled examples.

Why logistic regression? It's tiny, trains in milliseconds on a few dozen samples, and its
weights are just numbers, so we can send them to the browser and predict there (no video,
and no per-frame network calls, leave the machine).
"""

from collections import Counter

import numpy as np
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

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
    from sklearn.pipeline import make_pipeline

    clf = make_pipeline(
        StandardScaler(),
        MLPClassifier(hidden_layer_sizes=(32,), activation="relu", max_iter=2000, random_state=42),
    )

    cv = min(5, min_class_count)
    scores = cross_val_score(
        clf, x, labels, cv=StratifiedKFold(n_splits=cv, shuffle=True, random_state=42)
    )
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
    y = np.array(labels)

    # --- DATA AUGMENTATION ---
    # We turn a tiny dataset (~30 frames) into hundreds of robust examples
    # to prevent the Neural Network from overfitting to static images.
    x_aug, y_aug = [x], [y]

    # 1. Gaussian Jitter: simulate slight muscle twitches/camera noise
    noise_factor = 0.02  # 2% variation
    for _ in range(10):
        noise = np.random.normal(0, noise_factor, x.shape)
        x_aug.append(np.clip(x + noise, 0.0, 1.0))
        y_aug.append(y)

    # 2. Intra-class Interpolation: synthesize "in-between" expressions
    class_indices = {}
    for i, label in enumerate(y):
        class_indices.setdefault(label, []).append(i)

    for label, indices in class_indices.items():
        if len(indices) > 1:
            # Create 5 interpolated samples per real sample
            for _ in range(5 * len(indices)):
                i1, i2 = np.random.choice(indices, 2, replace=False)
                alpha = np.random.random()
                x_interp = alpha * x[i1] + (1 - alpha) * x[i2]
                x_aug.append(np.expand_dims(x_interp, axis=0))
                y_aug.append(np.array([label]))

    x_train = np.vstack(x_aug)
    y_train = np.hstack(y_aug)

    scaler = StandardScaler().fit(x_train)
    clf = MLPClassifier(hidden_layer_sizes=(32,), activation="relu", max_iter=2000, random_state=42)
    clf.fit(scaler.transform(x_train), y_train)

    coefs = [c.tolist() for c in clf.coefs_]
    intercepts = [i.tolist() for i in clf.intercepts_]

    if len(clf.classes_) == 2:
        # sklearn stores ONE weight row for 2 classes in the final layer.
        # Convert it to the 2-row softmax form so the browser only needs one prediction code path.
        final_coef = np.array(coefs[-1])
        coefs[-1] = np.hstack([-final_coef / 2, final_coef / 2]).tolist()

        final_intercept = np.array(intercepts[-1])
        intercepts[-1] = np.array([-final_intercept[0] / 2, final_intercept[0] / 2]).tolist()

    return EmotionModel(
        user_id=user_id,
        feature_names=names,
        classes=list(clf.classes_),
        means=scaler.mean_.tolist(),
        scales=scaler.scale_.tolist(),
        coefs=coefs,
        intercepts=intercepts,
        n_samples=len(usable),
        accuracy=evaluate_model(samples),
    )
