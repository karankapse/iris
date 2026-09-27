"""Muse event shapes seen from the real API (ENDPOINTING mode)."""

import json

from app.services.muse import normalize_event


def ev(**kw):
    return json.dumps(kw)


def test_speech_complete_ends_the_turn_with_its_text():
    out = normalize_event(
        ev(type="speechComplete", turnId=1, audioProcessedMs=1820, transcript="Are you hungry?")
    )
    assert out == {"type": "transcript", "text": "Are you hungry?", "final": True}


def test_empty_final_transcript_and_speech_markers_are_ignored():
    assert normalize_event(ev(type="transcript", transcript="", final=True)) is None
    assert normalize_event(ev(type="speechStart", turnId=1)) is None
    assert normalize_event(ev(type="speechEnd", turnId=1)) is None
    assert normalize_event(ev(type="speechComplete", transcript="  ")) is None


def test_partials_still_come_through():
    assert normalize_event(ev(type="transcript", transcript="Are you", final=False)) == {
        "type": "transcript",
        "text": "Are you",
        "final": False,
    }
