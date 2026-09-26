import json

import pytest

from iris_agent.tone_map import (
    KNOWN_EMOTIONS,
    SPEED_RANGE,
    VOLUME_RANGE,
    UnknownToneError,
    load_tone_map,
)

# The six tones Iris uses. Keep in sync with EMOTIONS in the frontend and Emotion in the backend.
IRIS_TONES = {"neutral", "happy", "sad", "excited", "joking", "serious"}


def test_shared_config_covers_every_iris_tone():
    assert set(load_tone_map().tones) == IRIS_TONES


def test_every_tone_uses_a_real_cartesia_emotion_within_range():
    for name, s in load_tone_map().tones.items():
        assert s.emotion in KNOWN_EMOTIONS, f"{name}: {s.emotion!r} is not a Cartesia emotion"
        assert SPEED_RANGE[0] <= s.speed <= SPEED_RANGE[1]
        assert VOLUME_RANGE[0] <= s.volume <= VOLUME_RANGE[1]


def test_tones_actually_differ_from_each_other():
    tones = load_tone_map().tones
    assert tones["sad"].speed < tones["neutral"].speed < tones["excited"].speed
    assert tones["sad"].volume < tones["neutral"].volume
    assert len({t.emotion for t in tones.values()}) == len(tones)  # no two tones share an emotion


def test_user_speed_setting_scales_and_is_clamped():
    tm = load_tone_map()
    assert tm.settings_for("neutral", 1.2).speed == pytest.approx(1.2)
    assert tm.settings_for("sad", 0.5).speed == SPEED_RANGE[0]  # would be 0.425: clamped
    assert tm.settings_for("excited", 1.5).speed == SPEED_RANGE[1]  # would be 1.8: clamped


def test_unknown_tone_is_an_error():
    with pytest.raises(UnknownToneError):
        load_tone_map().settings_for("furious")


def test_out_of_range_values_in_the_file_are_clamped(tmp_path):
    path = tmp_path / "map.json"
    path.write_text(
        json.dumps(
            {
                "model": "sonic-3",
                "voice": "v",
                "tones": {"x": {"emotion": "happy", "speed": 9, "volume": 0.01}},
            }
        )
    )
    s = load_tone_map(path).tones["x"]
    assert (s.speed, s.volume) == (SPEED_RANGE[1], VOLUME_RANGE[0])
