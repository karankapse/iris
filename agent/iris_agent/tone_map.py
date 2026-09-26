"""Turns one of Iris's tones (happy, sad, ...) into Cartesia voice settings.

All the numbers live in ONE file, `shared/tone-voice-map.json`, so they are easy to tune (and the
frontend's tone tester reads the same file). This module only loads and checks that file.
"""

import json
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "shared" / "tone-voice-map.json"

# Cartesia Sonic-3 limits (docs.cartesia.ai). Values outside them are clamped, not rejected.
SPEED_RANGE = (0.6, 1.5)
VOLUME_RANGE = (0.5, 2.0)

# Every emotion name Cartesia's docs list as supported. Used to catch typos in the config.
KNOWN_EMOTIONS = frozenset(
    "neutral happy excited enthusiastic elated euphoric triumphant amazed surprised flirtatious "
    "curious content peaceful serene calm grateful affectionate trust sympathetic anticipation "
    "mysterious angry mad outraged frustrated agitated threatened disgusted contempt envious "
    "sarcastic ironic sad dejected melancholic disappointed hurt guilty bored tired rejected "
    "nostalgic wistful apologetic hesitant insecure confused resigned anxious panicked alarmed "
    "scared proud confident distant skeptical contemplative determined".split()
)


class UnknownToneError(ValueError):
    pass


@dataclass(frozen=True)
class VoiceSettings:
    emotion: str
    speed: float
    volume: float


def _clamp(value: float, bounds: tuple[float, float]) -> float:
    return min(bounds[1], max(bounds[0], value))


class ToneMap:
    def __init__(self, model: str, voice: str, tones: dict[str, VoiceSettings]):
        self.model = model
        self.voice = voice
        self.tones = tones

    def settings_for(self, tone: str, speed_multiplier: float = 1.0) -> VoiceSettings:
        """Voice settings for a tone. `speed_multiplier` is the user's own speech-speed setting."""
        base = self.tones.get(tone)
        if base is None:
            raise UnknownToneError(f"Unknown tone {tone!r}. Known tones: {sorted(self.tones)}")
        return VoiceSettings(
            emotion=base.emotion,
            speed=_clamp(base.speed * speed_multiplier, SPEED_RANGE),
            volume=_clamp(base.volume, VOLUME_RANGE),
        )


def load_tone_map(path: Path = DEFAULT_PATH) -> ToneMap:
    raw = json.loads(path.read_text())
    tones = {
        name: VoiceSettings(
            emotion=cfg["emotion"],
            speed=_clamp(float(cfg["speed"]), SPEED_RANGE),
            volume=_clamp(float(cfg["volume"]), VOLUME_RANGE),
        )
        for name, cfg in raw["tones"].items()
    }
    return ToneMap(model=raw["model"], voice=raw["voice"], tones=tones)
