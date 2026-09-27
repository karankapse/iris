"""First-letter typing: "iww" -> "I want water"."""

from types import SimpleNamespace

from app.services import llm
from app.services.initials import fits, initials_of


def test_initials_count_contractions_as_one_word():
    assert initials_of("I'm really thirsty, can I have water?") == "irtcihw"
    assert initials_of("Don't worry") == "dw"
    # typographic apostrophes (common in model output) are still one word
    assert initials_of("I\u2019m thirsty") == "it"
    assert fits("Don\u2019t worry", "dw")


def test_fits_needs_every_letter_in_order():
    assert fits("I want water", "IWW")
    assert fits("I want water", "i w w")
    assert not fits("I want some water", "iww")
    assert not fits("Water I want", "iww")


def test_mock_mode_offers_everyday_and_quick_phrases(client):
    res = client.post("/api/expand", json={"initials": "iww"})
    assert [s["text"] for s in res.json()["suggestions"]] == ["I want water"]
    res = client.post(
        "/api/expand",
        json={"initials": "gma", "profile": {"phrases": ["Get my apple"]}},
    )
    assert res.json()["suggestions"][0]["text"] == "Get my apple"


def test_claude_guesses_that_do_not_fit_are_dropped(monkeypatch, tmp_path):
    from app.config import Settings

    drafts = llm._Drafts(
        replies=[
            llm._Draft(text="I want some water please", tone="neutral"),  # too many words
            llm._Draft(text="I want water", tone="happy"),
            llm._Draft(text="I want, water!", tone="happy"),  # the same guess again
            llm._Draft(text="I would wait", tone="neutral"),
        ]
    )
    seen = {}

    class FakeClient:
        def __init__(self, api_key):
            self.messages = SimpleNamespace(parse=self.parse)

        def parse(self, **kwargs):
            seen.update(kwargs)
            return SimpleNamespace(parsed_output=drafts, stop_reason="end_turn")

    monkeypatch.setattr(llm.anthropic, "Anthropic", FakeClient)
    settings = Settings(database_path=tmp_path / "t.db", anthropic_api_key="k", mock_llm=False)
    items = llm.expand_initials(settings, "iww", [], None)
    assert [s.text for s in items] == ["I want water", "I would wait"]
    assert "I W W" in seen["messages"][0]["content"]
    assert seen["system"] == llm.EXPAND_PROMPT
