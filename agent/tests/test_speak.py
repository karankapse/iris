import json

import pytest

from iris_agent.speak import MAX_TEXT_CHARS, parse_speak_request
from iris_agent.tone_map import load_tone_map

TM = load_tone_map()


def payload(**over):
    return json.dumps({"text": "I love you", "tone": "happy", "speed": 1.0, **over})


def test_parses_a_valid_request():
    r = parse_speak_request(payload(text="  Thank you  "), TM)
    assert (r.text, r.tone, r.speed) == ("Thank you", "happy", 1.0)


def test_speed_is_optional():
    r = parse_speak_request(json.dumps({"text": "Hi", "tone": "sad"}), TM)
    assert r.speed == 1.0


@pytest.mark.parametrize(
    ("bad", "message"),
    [
        ("not json", "not valid JSON"),
        (payload(text=""), "Invalid speak request"),
        (payload(text="   "), "text is empty"),
        (payload(text="x" * (MAX_TEXT_CHARS + 1)), "Invalid speak request"),
        (payload(tone="furious"), "Unknown tone"),
        (payload(speed=9), "Invalid speak request"),
        (json.dumps({"tone": "happy"}), "Invalid speak request"),
    ],
)
def test_rejects_bad_requests_with_a_readable_message(bad, message):
    with pytest.raises(ValueError, match=message):
        parse_speak_request(bad, TM)
