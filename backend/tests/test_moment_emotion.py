"""How this moment feels: the partner's words + the user's face."""

from types import SimpleNamespace

from app.config import Settings
from app.schemas import ConversationTurn, FaceReaction
from app.services import llm
from app.services.llm import _Draft, _Drafts, _Feel, generate_reply_bundle
from app.services.moment_emotion import combine, words_emotion


def face(peak, confidence, **scores):
    return FaceReaction(scores=scores, peak=peak, confidence=confidence)


def test_words_carry_connotation():
    assert words_emotion("You got the job, congrats!") == "excited"
    assert words_emotion("Grandpa passed away last night") == "sad"
    assert words_emotion("Pass the salt") is None


def test_a_confident_face_wins():
    feel = combine("Tonight is movie night", face("happy", 0.8, happy=0.7, neutral=0.3))
    assert (feel.emotion, feel.source) == ("happy", "face")


def test_face_and_words_agreeing_are_surer():
    feel = combine("Great news, you got the job!", face("excited", 0.7, excited=0.7))
    assert feel.source == "face + words"
    assert feel.confidence > 0.7


def test_unsure_face_lets_the_words_decide():
    feel = combine("Great news, you got the job!", face("sad", 0.4, sad=0.3, neutral=0.7))
    assert (feel.emotion, feel.source) == ("excited", "words")
    assert combine("Great news!", None).emotion == "excited"  # no face at all


def test_disagreement_is_explained():
    feel = combine("Great news, you got the job!", face("sad", 0.9, sad=0.9))
    assert feel.emotion == "sad"
    assert "words sounded excited" in feel.reason


def test_nothing_stands_out():
    assert combine("Pass the salt", face(None, 0.0, neutral=1.0)).emotion == "neutral"


def test_mock_mode_leans_replies_toward_the_combined_feeling(tmp_path):
    settings = Settings(database_path=tmp_path / "t.db", anthropic_api_key="", mock_llm=True)
    history = [ConversationTurn(speaker="partner", text="Great news, you got the job!")]
    items, feel = generate_reply_bundle(settings, history, None)
    assert feel.emotion == "excited" and feel.source == "words"
    assert items[0].text == "Congrats thats awesome!"


def test_claude_returns_the_feeling_in_the_same_call(tmp_path, monkeypatch):
    seen = {}

    class FakeClient:
        def __init__(self, api_key):
            self.messages = SimpleNamespace(parse=self.parse)

        def parse(self, **kwargs):
            seen.update(kwargs)
            parsed = _Drafts(
                replies=[_Draft(text="Yes!", tone="happy")],
                conversation_emotion=_Feel(
                    emotion="happy", confidence=1.4, reason="smiling at good news", source="face"
                ),
            )
            return SimpleNamespace(parsed_output=parsed, stop_reason="end_turn")

    monkeypatch.setattr(llm.anthropic, "Anthropic", FakeClient)
    settings = Settings(database_path=tmp_path / "t.db", anthropic_api_key="k", mock_llm=False)
    history = [ConversationTurn(speaker="partner", text="Want to go to the park?")]
    items, feel = generate_reply_bundle(
        settings, history, None, face=face("happy", 0.8, happy=0.75, neutral=0.25)
    )
    assert [i.text for i in items] == ["Yes!"]
    assert (feel.emotion, feel.confidence, feel.source) == ("happy", 1.0, "face")
    content = seen["messages"][0]["content"]
    assert "My face while listening: happy 0.75, neutral 0.25; strongest: happy" in content
    assert "conversation_emotion" in seen["system"]


def test_claude_without_a_feeling_falls_back_to_the_rules(tmp_path, monkeypatch):
    class FakeClient:
        def __init__(self, api_key):
            self.messages = SimpleNamespace(
                parse=lambda **_: SimpleNamespace(
                    parsed_output=_Drafts(replies=[_Draft(text="Oh no.", tone="sad")]),
                    stop_reason="end_turn",
                )
            )

    monkeypatch.setattr(llm.anthropic, "Anthropic", FakeClient)
    settings = Settings(database_path=tmp_path / "t.db", anthropic_api_key="k", mock_llm=False)
    history = [ConversationTurn(speaker="partner", text="Grandpa passed away")]
    _, feel = generate_reply_bundle(settings, history, None)
    assert (feel.emotion, feel.source) == ("sad", "words")


def test_suggestions_endpoint_returns_the_feeling(client):
    body = {
        "history": [{"speaker": "partner", "text": "Great news, you got the job!"}],
        "face_reaction": {"scores": {"happy": 0.8}, "peak": "happy", "confidence": 0.8},
    }
    data = client.post("/api/suggestions", json=body).json()
    assert data["conversation_emotion"]["emotion"] == "happy"
    assert data["conversation_emotion"]["source"] == "face"
    assert 3 <= len(data["suggestions"]) <= 4
