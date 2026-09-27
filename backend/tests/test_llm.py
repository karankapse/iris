"""Tests for how the conversation is described to Claude (originally by Arya, adapted to the
shared UserProfile in app/schemas/profile.py)."""

from app.schemas import ConversationTurn, UserProfile
from app.services.llm import MAX_HISTORY_TURNS, _format_history
from app.services.llm_mock import mock_suggestions


def test_format_history_with_profile():
    history = [ConversationTurn(speaker="partner", text="How are you?")]
    profile = UserProfile(
        name="Arya",
        relationships=["Sarah (wife)", "Dr. Smith (doctor)"],
        common_needs=["water", "adjust pillow"],
    )

    formatted = _format_history(history, mood="happy", profile=profile)

    assert "My name is Arya." in formatted
    assert "Sarah (wife)" in formatted
    assert "Dr. Smith (doctor)" in formatted
    assert "water, adjust pillow" in formatted
    assert "My persistent mood setting: happy." in formatted
    assert "Partner: How are you?" in formatted


def test_format_history_trims_long_history():
    history = [ConversationTurn(speaker="partner", text=f"Message {i}") for i in range(15)]
    formatted = _format_history(history, mood=None, profile=None)

    # Only the last MAX_HISTORY_TURNS (10) are sent: messages 5..14
    assert MAX_HISTORY_TURNS == 10
    assert "Message 4\n" not in formatted
    assert "Message 5" in formatted
    assert "Message 14" in formatted


def test_format_history_no_profile():
    history = [ConversationTurn(speaker="partner", text="Hello")]
    formatted = _format_history(history, mood=None, profile=None)

    assert "About me" not in formatted
    assert "no specific mood or reaction" in formatted
    assert "Partner: Hello" in formatted


def test_mock_suggestions_use_the_profile():
    profile = UserProfile(name="Arya", common_needs=["adjust my pillow"])
    name = mock_suggestions(
        [ConversationTurn(speaker="partner", text="What is your name?")], profile=profile
    )
    assert name[0].text == "My name is Arya."
    needs = mock_suggestions(
        [ConversationTurn(speaker="partner", text="Do you need anything?")], profile=profile
    )
    assert needs[0].text == "Yes, please adjust my pillow."
