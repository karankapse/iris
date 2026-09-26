import pytest
from app.schemas.conversation import ConversationTurn, UserProfile
from app.services.llm import _format_history

def test_format_history_with_profile():
    history = [ConversationTurn(speaker="partner", text="How are you?")]
    profile = UserProfile(
        name="Arya",
        relationships={"Sarah": "wife", "Dr. Smith": "doctor"},
        common_needs=["water", "adjust pillow"]
    )
    
    formatted = _format_history(history, mood="happy", profile=profile)
    
    assert "Context about me:" in formatted
    assert "My name: Arya" in formatted
    assert "Sarah (wife)" in formatted
    assert "Dr. Smith (doctor)" in formatted
    assert "water, adjust pillow" in formatted
    assert "My current mood setting: happy." in formatted
    assert "Partner: How are you?" in formatted

def test_format_history_trims_long_history():
    history = [ConversationTurn(speaker="partner", text=f"Message {i}") for i in range(15)]
    formatted = _format_history(history, mood=None, profile=None)
    
    # It should only keep the last 10 messages (indices 5 through 14)
    assert "Message 4" not in formatted
    assert "Message 5" in formatted
    assert "Message 14" in formatted

def test_format_history_no_profile():
    history = [ConversationTurn(speaker="partner", text="Hello")]
    formatted = _format_history(history, mood=None, profile=None)
    
    assert "Context about me:" in formatted
    assert "(No user profile provided)" in formatted
    assert "My current mood setting: none." in formatted
