import asyncio
import json

import pytest

from iris_agent.speaker import Speaker
from iris_agent.tone_map import load_tone_map


class FakeHandle:
    """Like livekit's SpeechHandle: awaiting it waits until the speech has finished playing."""

    def __init__(self, log, text, play_ms):
        self._log, self._text, self._play_ms = log, text, play_ms

    def __await__(self):
        async def play():
            self._log.append(("start", self._text))
            await asyncio.sleep(self._play_ms / 1000)
            self._log.append(("end", self._text))

        return play().__await__()


class FakeSession:
    def __init__(self, log, play_ms=10):
        self.log, self.play_ms, self.interrupted = log, play_ms, None

    def say(self, text, **kwargs):
        self.log.append(("say", text, kwargs))
        return FakeHandle(self.log, text, self.play_ms)

    async def interrupt(self, *, force=False):
        self.interrupted = force


class FakeTts:
    def __init__(self, log):
        self.log = log

    def update_options(self, **kwargs):
        self.log.append(("options", kwargs))


def make(play_ms=10):
    log: list = []
    return Speaker(FakeSession(log, play_ms), FakeTts(log), load_tone_map()), log


def req(text="I love you", tone="happy", speed=1.0):
    return json.dumps({"text": text, "tone": tone, "speed": speed})


def test_sets_the_tones_voice_options_BEFORE_speaking_the_exact_text():
    speaker, log = make()
    assert asyncio.run(speaker.speak(req("I love you", "sad"))) == "done"

    kinds = [entry[0] for entry in log]
    assert kinds.index("options") < kinds.index("say")  # tone first, then speech
    options = next(e[1] for e in log if e[0] == "options")
    assert options == {"emotion": "sad", "speed": pytest.approx(0.85), "volume": pytest.approx(0.8)}
    said = next(e for e in log if e[0] == "say")
    assert said[1] == "I love you"  # EXACTLY the text, unchanged
    assert said[2] == {"allow_interruptions": False, "add_to_chat_ctx": False}


def test_waits_until_the_audio_has_finished():
    speaker, log = make(play_ms=30)
    asyncio.run(speaker.speak(req()))
    assert log[-1] == ("end", "I love you")  # returned only after playback ended


def test_user_speed_setting_reaches_the_voice():
    speaker, log = make()
    asyncio.run(speaker.speak(req(tone="neutral", speed=1.3)))
    assert next(e[1] for e in log if e[0] == "options")["speed"] == pytest.approx(1.3)


def test_invalid_requests_never_reach_the_voice():
    speaker, log = make()
    with pytest.raises(ValueError):
        asyncio.run(speaker.speak(req(tone="furious")))
    assert log == []  # nothing was set or spoken


def test_two_replies_never_overlap_or_share_tone_settings():
    speaker, log = make(play_ms=30)

    async def both():
        await asyncio.gather(
            speaker.speak(req("first", "sad")), speaker.speak(req("second", "excited"))
        )

    asyncio.run(both())
    spoken = [e for e in log if e[0] in ("options", "start", "end")]
    # options(first) start(first) end(first) options(second) start(second) end(second)
    assert [e[0] for e in spoken] == ["options", "start", "end", "options", "start", "end"]
    assert spoken[0][1]["emotion"] == "sad" and spoken[3][1]["emotion"] == "excited"


def test_cancel_interrupts_forcefully():
    speaker, _ = make()
    assert asyncio.run(speaker.cancel()) == "cancelled"
    assert speaker._session.interrupted is True
