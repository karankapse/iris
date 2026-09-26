import math

FEATURES = ["smile", "brow", "squint"]


def _samples(label, rows, source="calibration"):
    return [{"label": label, "features": r, "source": source} for r in rows]


def test_health_reports_mock_mode(client):
    body = client.get("/api/health").json()
    assert body == {
        "ok": True,
        "mock_llm": True,
        "stt_configured": False,
        "voice_configured": False,
    }


def test_suggestions_are_3_or_4_and_valid(client):
    res = client.post(
        "/api/suggestions",
        json={"history": [{"speaker": "partner", "text": "Are you hungry?"}], "mood": "happy"},
    )
    assert res.status_code == 200
    items = res.json()["suggestions"]
    assert 3 <= len(items) <= 4
    assert all(s["tone"] in {"neutral", "happy", "sad", "joking", "serious"} for s in items)


def test_suggestions_reject_unknown_tone_in_mood(client):
    res = client.post("/api/suggestions", json={"history": [], "mood": "furious"})
    assert res.status_code == 422


def _train(client):
    smiling = [[0.9, 0.0, 0.1], [0.8, 0.1, 0.2], [0.85, 0.05, 0.1]]
    frowning = [[0.0, 0.9, 0.8], [0.1, 0.8, 0.9], [0.05, 0.85, 0.85]]
    payload = {
        "user_id": "u1",
        "feature_names": FEATURES,
        "samples": _samples("happy", smiling) + _samples("serious", frowning),
    }
    assert client.post("/api/emotion/samples", json=payload).status_code == 201
    return client.post("/api/emotion/train", json={"user_id": "u1"})


def test_train_returns_exportable_model_that_predicts_correctly(client):
    res = _train(client)
    assert res.status_code == 200
    m = res.json()

    # Re-implement the browser's prediction to prove the exported weights are usable.
    def predict(x):
        scaled = [(v - mu) / s for v, mu, s in zip(x, m["means"], m["scales"], strict=True)]
        logits = [
            sum(w * v for w, v in zip(row, scaled, strict=True)) + b
            for row, b in zip(m["coef"], m["intercept"], strict=True)
        ]
        exps = [math.exp(z - max(logits)) for z in logits]
        probs = [e / sum(exps) for e in exps]
        return m["classes"][probs.index(max(probs))]

    assert m["classes"] == ["happy", "serious"]
    assert len(m["coef"]) == 2 and len(m["coef"][0]) == 3  # binary case expanded to 2 rows
    assert predict([0.9, 0.0, 0.0]) == "happy"
    assert predict([0.0, 0.9, 0.9]) == "serious"


def test_model_is_stored_and_retrievable(client):
    _train(client)
    assert client.get("/api/emotion/model/u1").json()["n_samples"] == 6
    assert client.get("/api/emotion/model/nobody").status_code == 404


def test_train_needs_two_emotions(client):
    payload = {
        "user_id": "u2",
        "feature_names": FEATURES,
        "samples": _samples("happy", [[1, 0, 0], [0.9, 0, 0]]),
    }
    client.post("/api/emotion/samples", json=payload)
    assert client.post("/api/emotion/train", json={"user_id": "u2"}).status_code == 422


def test_samples_reject_wrong_feature_count(client):
    payload = {
        "user_id": "u3",
        "feature_names": FEATURES,
        "samples": _samples("happy", [[1, 0]]),
    }
    assert client.post("/api/emotion/samples", json=payload).status_code == 422


def test_positive_feedback_becomes_training_sample_negative_does_not(client):
    base = {
        "user_id": "u4",
        "utterance_id": "a",
        "reply_text": "Hi",
        "spoken_tone": "happy",
        "feature_names": FEATURES,
        "features": [0.9, 0, 0.1],
    }
    ok = client.post("/api/feedback", json={**base, "user_tone_ok": True}).json()
    assert ok["added_training_sample"] is True

    bad = client.post("/api/feedback", json={**base, "utterance_id": "b", "user_tone_ok": False})
    assert bad.json()["added_training_sample"] is False

    partner = client.post(
        "/api/feedback",
        json={**base, "utterance_id": "c", "partner_reaction": "seemed_off"},
    )
    assert partner.status_code == 201
    assert partner.json()["added_training_sample"] is False
