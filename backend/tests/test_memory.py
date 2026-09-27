"""Conversation-mood memory: log moments, find similar ones, and hand them to Claude."""

from app.routers import conversation as conversation_router
from app.services.conversation_memory import keywords, memory_prompt, similar_moments


def _row(partner, felt, reply, tone, ok=None):
    return {
        "partner_text": partner,
        "detected_emotion": felt,
        "reply_text": reply,
        "reply_tone": tone,
        "tone_ok": ok,
    }


def test_keywords_ignore_filler_and_stem():
    assert keywords("Are you in pain today?") == {"pain"}
    assert keywords("Does your back hurt?") == keywords("my back hurts")


def test_finds_similar_moments_best_first():
    past = [
        _row("Do you want to watch the game?", "excited", "Yes, turn it on!", "excited"),
        _row("Is your back hurting again?", "sad", "Yes, it hurts a lot.", "serious"),
        _row("Want some tea?", "happy", "Sure, thanks.", "happy"),
    ]
    hits = similar_moments(past, "Does your back hurt?")
    assert [h["reply_text"] for h in hits] == ["Yes, it hurts a lot."]
    assert similar_moments(past, "What's the weather like?") == []


def test_prompt_says_how_they_usually_felt_and_flags_wrong_tones():
    text = memory_prompt(
        [
            _row("Is your back hurting?", "sad", "Yes, a lot.", "serious", ok=1),
            _row("Back pain again?", "sad", "A little.", "joking", ok=0),
        ]
    )
    assert "most often felt sad (2 of 2)" in text
    assert "tone felt WRONG" in text
    assert memory_prompt([]) == ""


def log(client, partner, felt, reply, tone, uid):
    return client.post(
        "/api/conversation/log",
        json={
            "utterance_id": uid,
            "partner_text": partner,
            "detected_emotion": felt,
            "emotion_confidence": 0.8,
            "mood": None,
            "reply_text": reply,
            "reply_tone": tone,
        },
    )


def test_log_list_rate_and_forget(client):
    assert log(client, "Are you in pain?", "sad", "Yes, my back.", "serious", "u1").json() == {
        "stored": True
    }
    # nothing was said to them: nothing to learn
    assert log(client, "", "happy", "Thank you", "happy", "u2").json() == {"stored": False}

    client.post(
        "/api/feedback",
        json={
            "user_id": "local-user",
            "utterance_id": "u1",
            "reply_text": "Yes, my back.",
            "spoken_tone": "serious",
            "user_tone_ok": True,
        },
    )
    memory = client.get("/api/conversation/memory/local-user").json()
    assert memory["count"] == 1
    assert memory["entries"][0]["tone_ok"] is True
    assert memory["entries"][0]["detected_emotion"] == "sad"

    assert client.delete("/api/conversation/memory/local-user").json() == {"deleted": 1}
    assert client.get("/api/conversation/memory/local-user").json()["count"] == 0


def test_suggestions_receive_similar_past_moments(client, monkeypatch):
    seen = {}

    def fake_generate(settings, history, mood, profile, reaction, memory, face=None):
        seen["memory"] = memory
        return [], None

    monkeypatch.setattr(conversation_router, "generate_reply_bundle", fake_generate)
    log(client, "Is your back hurting?", "sad", "Yes, it hurts.", "serious", "u1")
    log(client, "Want to watch the game?", "excited", "Yes!", "excited", "u2")

    client.post(
        "/api/suggestions",
        json={"history": [{"speaker": "partner", "text": "Does your back hurt today?"}]},
    )
    assert "Yes, it hurts." in seen["memory"]
    assert "watch the game" not in seen["memory"]

    client.post(
        "/api/suggestions", json={"history": [{"speaker": "partner", "text": "Nice weather?"}]}
    )
    assert seen["memory"] == ""
