"""Trains a small per-user emotion classifier from that user's own labelled examples.

Why logistic regression? It's tiny, trains in milliseconds on a few dozen samples, and its
weights are just numbers, so we can send them to the browser and predict there (no video,
and no per-frame network calls, leave the machine).

Making it good with little data:
  - Honest accuracy: frames of one recording are near-identical, so the model is checked on
    whole recordings it did NOT train on (grouped cross-validation), never on shuffled frames.
  - The regularisation strength C is picked by that check.
  - No emotion may drown out the others (capped at MAX_CLASS_RATIO x the rarest one).
  - Recent recordings count more than old ones (faces, light and camera position drift).
"""

from collections import Counter, defaultdict

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.preprocessing import StandardScaler

from app.schemas import EmotionModel


class NotEnoughData(ValueError):
    pass


C_GRID = (0.03, 0.1, 0.3, 1.0, 3.0)
DEFAULT_C = 1.0
# No emotion may have more than this many times the frames of the rarest one (newest kept).
MAX_CLASS_RATIO = 3
# A recording this many recordings older than the newest one counts half as much.
HALF_LIFE_RECORDINGS = 30
MIN_WEIGHT = 0.2
# Per-emotion accuracy below this gets a "record it again" hint.
GOOD_ENOUGH = 0.6


def _recordings(samples: list[dict]) -> list[str]:
    """Which recording each sample came from. Old samples have none: consecutive samples with
    the same label and source were stored together, so they count as one recording."""
    out, run, prev = [], 0, None
    for s in samples:
        if s.get("recording"):
            out.append(str(s["recording"]))
            prev = None
            continue
        key = (s["label"], s.get("source"))
        if key != prev:
            run += 1
            prev = key
        out.append(f"run-{run}")
    return out


def _balance(labels: list[str]) -> np.ndarray:
    """Indices to keep: each emotion at most MAX_CLASS_RATIO x the rarest one (newest kept)."""
    counts = Counter(labels)
    cap = MAX_CLASS_RATIO * min(counts.values())
    keep, seen = [], Counter()
    for i in range(len(labels) - 1, -1, -1):  # newest first
        if seen[labels[i]] < cap:
            seen[labels[i]] += 1
            keep.append(i)
    return np.array(sorted(keep))


def _recency_weights(groups: np.ndarray) -> np.ndarray:
    """Newer recordings weigh more: 1.0 for the newest, halving every HALF_LIFE_RECORDINGS."""
    order: dict[str, int] = {}
    for g in groups:  # samples are oldest first, so the last time a group appears sets its rank
        order.pop(g, None)
        order[g] = len(order)
    newest = len(order) - 1
    ages = np.array([newest - order[g] for g in groups], dtype=float)
    return np.maximum(MIN_WEIGHT, 0.5 ** (ages / HALF_LIFE_RECORDINGS))


def _fit(x: np.ndarray, y: np.ndarray, w: np.ndarray, c: float):
    scaler = StandardScaler().fit(x)
    clf = LogisticRegression(max_iter=2000, class_weight="balanced", C=c)
    clf.fit(scaler.transform(x), y, sample_weight=w)
    return scaler, clf


def _held_out_predictions(x, y, groups, w, c) -> np.ndarray | None:
    """Predict every sample with a model that never saw its recording (None if impossible)."""
    n_groups = len(set(groups))
    if n_groups < 3:
        return None
    pred = np.empty(len(y), dtype=object)
    for train, test in GroupKFold(n_splits=min(5, n_groups)).split(x, y, groups):
        if len(set(y[train])) < 2:
            return None
        scaler, clf = _fit(x[train], y[train], w[train], c)
        pred[test] = clf.predict(scaler.transform(x[test]))
    return pred


def _per_class(y: np.ndarray, pred: np.ndarray) -> dict[str, float]:
    return {str(c): round(float(np.mean(pred[y == c] == c)), 2) for c in sorted(set(y.tolist()))}


def _advice(y, groups, pred) -> list[str]:
    recordings: dict[str, set] = defaultdict(set)
    for label, g in zip(y, groups, strict=True):
        recordings[label].add(g)
    tips = []
    for label in sorted(recordings):
        if len(recordings[label]) < 2:
            tips.append(f"{label} needs more examples (record it at least once more)")
        elif pred is not None:
            mine = pred[y == label]
            if np.mean(mine == label) < GOOD_ENOUGH:
                wrong = Counter(p for p in mine if p != label).most_common(1)
                mixed = f", it looks like {wrong[0][0]}" if wrong else ""
                tips.append(f"{label} needs more examples{mixed}: record it again, more clearly")
    return tips


def train_model(user_id: str, samples: list[dict]) -> EmotionModel:
    if not samples:
        raise NotEnoughData("No samples yet. Run the calibration first.")

    # Use the most recent feature layout; ignore older samples with a different layout.
    names = samples[-1]["feature_names"]
    usable = [s for s in samples if s["feature_names"] == names]

    labels = [s["label"] for s in usable]
    if len(set(labels)) < 2:
        raise NotEnoughData("Need examples of at least 2 different emotions to train.")

    keep = _balance(labels)
    x = np.array([usable[i]["features"] for i in keep], dtype=float)
    y = np.array([labels[i] for i in keep], dtype=object)
    groups = np.array(_recordings(usable), dtype=object)[keep]
    w = _recency_weights(groups)

    # Pick C by the held-out check (balanced: every emotion counts the same).
    best_c, best_score, best_pred = DEFAULT_C, -1.0, None
    for c in C_GRID:
        pred = _held_out_predictions(x, y, groups, w, c)
        if pred is None:
            break
        score = float(np.mean(list(_per_class(y, pred).values())))
        if score > best_score:
            best_c, best_score, best_pred = c, score, pred

    scaler, clf = _fit(x, y, w, best_c)
    coef, intercept = clf.coef_, clf.intercept_
    if len(clf.classes_) == 2:
        # sklearn stores ONE weight row for 2 classes (sigmoid form). Convert it to the
        # 2-row softmax form so the browser only needs one prediction code path.
        coef = np.vstack([-coef[0] / 2, coef[0] / 2])
        intercept = np.array([-intercept[0] / 2, intercept[0] / 2])

    per_class = _per_class(y, best_pred) if best_pred is not None else {}
    advice = _advice(y, groups, best_pred)
    if best_pred is None:
        advice.append("Record each emotion at least twice so the accuracy can be checked.")
    return EmotionModel(
        user_id=user_id,
        feature_names=names,
        classes=list(clf.classes_),
        means=scaler.mean_.tolist(),
        scales=scaler.scale_.tolist(),
        coef=coef.tolist(),
        intercept=intercept.tolist(),
        n_samples=len(y),
        accuracy=round(best_score, 2) if best_pred is not None else None,
        per_class_accuracy=per_class,
        advice=advice,
    )
