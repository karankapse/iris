"""The camera emotion model: more frames, honest accuracy, balance and recency."""

import numpy as np

from app.services.emotion_trainer import (
    MAX_CLASS_RATIO,
    _recency_weights,
    _recordings,
    train_model,
)

NAMES = ["smile", "frown", "brow"]
CENTERS = {"happy": [0.9, 0.0, 0.1], "sad": [0.0, 0.8, 0.7], "neutral": [0.1, 0.1, 0.1]}


def recording(label, rec, n=20, center=None, noise=0.05, seed=0):
    rng = np.random.default_rng(seed)
    c = np.array(center if center is not None else CENTERS[label])
    return [
        {
            "label": label,
            "feature_names": NAMES,
            "features": (c + rng.normal(0, noise, 3)).tolist(),
            "source": "calibration",
            "recording": rec,
        }
        for _ in range(n)
    ]


def test_clear_expressions_score_well_on_unseen_recordings():
    samples = []
    for r in range(3):
        for label in CENTERS:
            samples += recording(label, f"{label}-{r}", seed=r * 10 + len(samples))
    m = train_model("u", samples)
    assert m.accuracy is not None and m.accuracy >= 0.9
    assert set(m.per_class_accuracy) == set(CENTERS)
    assert m.advice == []


def test_accuracy_is_checked_on_whole_recordings_not_shuffled_frames():
    # Every recording is its own tight cluster in a random place: nothing generalises. Shuffled
    # frames would score ~100%; held-out recordings must not.
    rng = np.random.default_rng(1)
    samples = []
    for r in range(12):
        label = "happy" if r % 2 else "sad"
        samples += recording(label, f"r{r}", center=rng.uniform(0, 1, 3), noise=0.01, seed=r)
    m = train_model("u", samples)
    assert m.accuracy is not None and m.accuracy < 0.8
    assert any("needs more examples" in tip for tip in m.advice)


def test_one_recording_per_emotion_asks_for_more():
    samples = recording("happy", "h1") + recording("sad", "s1", seed=2)
    m = train_model("u", samples)
    assert m.accuracy is None
    assert "happy needs more examples (record it at least once more)" in m.advice
    assert any("at least twice" in tip for tip in m.advice)


def test_no_emotion_drowns_out_the_others():
    samples = recording("happy", "h1", n=100) + recording("sad", "s1", n=10, seed=3)
    assert train_model("u", samples).n_samples == 10 + MAX_CLASS_RATIO * 10


def test_recent_recordings_count_more():
    w = _recency_weights(np.array(["old"] * 2 + [f"r{i}" for i in range(40)] + ["new"]))
    assert w[-1] == 1.0
    assert w[0] < w[-2] < w[-1]
    assert w.min() >= 0.2


def test_old_samples_without_a_recording_are_grouped_by_run():
    rows = [{"label": lbl, "source": "calibration"} for lbl in ("happy", "happy", "sad", "happy")]
    assert _recordings(rows) == ["run-1", "run-1", "run-2", "run-3"]


def test_confirmed_tone_saves_every_reaction_frame(client):
    frames = [[0.9, 0.0, 0.1 + i / 100] for i in range(10)]
    body = {
        "user_id": "u9",
        "utterance_id": "x",
        "reply_text": "Yay",
        "spoken_tone": "happy",
        "user_tone_ok": True,
        "feature_names": NAMES,
        "feature_frames": frames + [[1.0]],  # a frame of the wrong length is skipped
    }
    assert client.post("/api/feedback", json=body).json()["added_training_sample"] is True
    sad = {
        "user_id": "u9",
        "feature_names": NAMES,
        "samples": [{"label": "sad", "features": [0, 0.8, 0.7]}] * 5,
    }
    client.post("/api/emotion/samples", json=sad)
    model = client.post("/api/emotion/train", json={"user_id": "u9"}).json()
    assert model["n_samples"] == 10 + 5
