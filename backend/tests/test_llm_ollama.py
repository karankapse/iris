"""Ollama suggestions (LLM_PROVIDER=ollama), tested against a fake Ollama: no model needed."""

import json

import httpx
import pytest

from app.config import Settings
from app.schemas import ConversationTurn
from app.services import llm
from app.services.llm import generate_suggestions

HISTORY = [ConversationTurn(speaker="partner", text="Are you hungry?")]


@pytest.fixture
def settings(tmp_path, monkeypatch):
    # Env vars override .env, so a developer's local settings can't change these tests.
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.setenv("OLLAMA_MODEL", "test-model")
    return Settings(database_path=tmp_path / "t.db", anthropic_api_key="", mock_llm=False)


def _fake_ollama(monkeypatch, replies=None, content=None, error=None):
    """Replace httpx.post with a fake Ollama; returns the dict the request is recorded in."""
    seen = {}

    def post(url, json, timeout):  # noqa: A002 - mirrors httpx.post's keyword
        seen.update(url=url, body=json)
        if error:
            raise error
        text = content if content is not None else _dumps({"replies": replies})
        return httpx.Response(
            200, json={"message": {"content": text}}, request=httpx.Request("POST", url)
        )

    monkeypatch.setattr(llm.httpx, "post", post)
    return seen


def _dumps(obj):
    return json.dumps(obj)


def test_uses_native_endpoint_with_schema(settings, monkeypatch):
    seen = _fake_ollama(
        monkeypatch,
        replies=[
            {"text": "Yes, please!", "tone": "happy"},
            {"text": "Not right now.", "tone": "neutral"},
            {"text": "  ", "tone": "neutral"},  # blank replies are dropped
        ],
    )
    items = generate_suggestions(settings, HISTORY, "happy")

    assert [(s.text, s.tone) for s in items] == [
        ("Yes, please!", "happy"),
        ("Not right now.", "neutral"),
    ]
    assert seen["url"].endswith("/api/chat")
    assert seen["body"]["model"] == "test-model"
    assert seen["body"]["format"] == llm._Drafts.model_json_schema()
    assert "Are you hungry?" in seen["body"]["messages"][1]["content"]


def test_keeps_at_most_four(settings, monkeypatch):
    _fake_ollama(monkeypatch, replies=[{"text": f"Reply {i}", "tone": "sad"} for i in range(6)])
    assert len(generate_suggestions(settings, HISTORY, None)) == 4


@pytest.mark.parametrize(
    "kwargs",
    [
        {"content": "not json"},
        {"replies": [{"text": "Hi", "tone": "serial"}]},  # tone outside the allowed list
        {"replies": []},
        {"error": httpx.ConnectError("connection refused")},  # Ollama not running
    ],
)
def test_failures_fall_back_to_canned_replies(settings, monkeypatch, kwargs):
    _fake_ollama(monkeypatch, **kwargs)
    items = generate_suggestions(settings, HISTORY, None)
    assert items and all(s.id.startswith("mock-") for s in items)


def test_mock_llm_overrides_ollama(settings, monkeypatch):
    seen = _fake_ollama(monkeypatch, replies=[{"text": "From Ollama", "tone": "happy"}])
    items = generate_suggestions(settings.model_copy(update={"mock_llm": True}), HISTORY, None)
    assert all(s.id.startswith("mock-") for s in items)
    assert seen == {}  # Ollama was never called
