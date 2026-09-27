"""Prompt building for suggestions (from Arya's user-context work, on the shared UserProfile)."""

from app.schemas import ConversationTurn, UserProfile
from app.services.llm import SYSTEM_PROMPT, _format_history
from app.services.llm_mock import mock_suggestions


def test_format_history_with_profile():
    history = [ConversationTurn(speaker="partner", text="How are you?")]
    profile = UserProfile(
        name="Arya",
        relationships=["wife Sarah", "doctor Dr. Smith"],
        common_needs=["water", "adjust pillow"],
    )
    formatted = _format_history(history, mood="happy", profile=profile)
    assert "My name is Arya." in formatted
    assert "wife Sarah" in formatted and "doctor Dr. Smith" in formatted
    assert "water, adjust pillow" in formatted
    assert "happy" in formatted
    assert "Partner: How are you?" in formatted


def test_format_history_trims_long_history():
    history = [ConversationTurn(speaker="partner", text=f"Message {i}") for i in range(15)]
    formatted = _format_history(history, mood=None, profile=None)
    # only the last 10 messages (5 through 14)
    assert "Message 4" not in formatted.replace("Message 14", "")
    assert "Message 5" in formatted
    assert "Message 14" in formatted


def test_format_history_without_profile_still_works():
    formatted = _format_history(
        [ConversationTurn(speaker="partner", text="Hello")], mood=None, profile=None
    )
    assert "Partner: Hello" in formatted
    assert "About me" not in formatted


def test_prompt_uses_past_replies():
    assert "previous replies" in SYSTEM_PROMPT


def test_mock_answers_name_and_needs_from_the_profile():
    profile = UserProfile(name="Arya", common_needs=["a blanket"])
    ask = lambda text: mock_suggestions(  # noqa: E731
        [ConversationTurn(speaker="partner", text=text)], profile=profile
    )
    assert any("Arya" in s.text for s in ask("What is your name?"))
    assert any("a blanket" in s.text for s in ask("Do you need anything?"))
