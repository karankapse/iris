"""Claude suggestions, tested against a fake Anthropic client: no API key or network needed."""

from types import SimpleNamespace

import pytest

from app.config import Settings
from app.schemas import ConversationTurn, UserProfile
from app.services import llm
from app.services.llm import _Draft, _Drafts, generate_suggestions

HISTORY = [ConversationTurn(speaker="partner", text="Are you hungry?")]


@pytest.fixture
def settings(tmp_path):
    return Settings(
        database_path=tmp_path / "t.db",
        anthropic_api_key="test-key",
        anthropic_model="claude-sonnet-5",
        mock_llm=False,
    )


def _fake_claude(monkeypatch, parsed, stop_reason="end_turn"):
    """Replace anthropic.Anthropic with a fake; returns the dict the call is recorded in."""
    seen = {}

    class FakeClient:
        def __init__(self, api_key):
            seen["api_key"] = api_key
            self.messages = SimpleNamespace(parse=self.parse)

        def parse(self, **kwargs):
            seen.update(kwargs)
            return SimpleNamespace(parsed_output=parsed, stop_reason=stop_reason)

    monkeypatch.setattr(llm.anthropic, "Anthropic", FakeClient)
    return seen


def _drafts(*pairs):
    return _Drafts(replies=[_Draft(text=t, tone=tone) for t, tone in pairs])


def test_calls_claude_with_schema_and_profile(settings, monkeypatch):
    seen = _fake_claude(monkeypatch, _drafts(("Yes, please!", "excited"), ("Not now.", "neutral")))
    profile = UserProfile(name="Sam", interests=["chess"])
    items = generate_suggestions(settings, HISTORY, "happy", profile)

    assert [(s.text, s.tone) for s in items] == [
        ("Yes, please!", "excited"),
        ("Not now.", "neutral"),
    ]
    assert seen["api_key"] == "test-key"
    assert seen["model"] == "claude-sonnet-5"
    assert seen["output_format"] is _Drafts
    assert seen["thinking"] == {"type": "disabled"}
    content = seen["messages"][0]["content"]
    assert "My name is Sam." in content and "Are you hungry?" in content


def test_keeps_at_most_four(settings, monkeypatch):
    _fake_claude(monkeypatch, _drafts(*[(f"Reply {i}", "sad") for i in range(6)]))
    assert len(generate_suggestions(settings, HISTORY, None)) == 4


@pytest.mark.parametrize("parsed", [None, _drafts()])
def test_no_usable_output_falls_back_to_canned_replies(settings, monkeypatch, parsed):
    _fake_claude(monkeypatch, parsed, stop_reason="refusal")
    items = generate_suggestions(settings, HISTORY, None)
    assert items and all(s.id.startswith("mock-") for s in items)


@pytest.mark.parametrize("update", [{"mock_llm": True}, {"anthropic_api_key": ""}])
def test_mock_mode_never_calls_claude(settings, monkeypatch, update):
    seen = _fake_claude(monkeypatch, _drafts(("From Claude", "happy")))
    items = generate_suggestions(settings.model_copy(update=update), HISTORY, None)
    assert all(s.id.startswith("mock-") for s in items)
    assert seen == {}  # the client was never created
