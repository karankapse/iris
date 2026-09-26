"""Settings, read from environment variables or the repo-root `.env` file.

The API key lives ONLY here (server side). The browser never sees it: Vite only
exposes variables that start with `VITE_`, and this one doesn't.
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> parents[2] is the repo root
REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5"
    # Force canned suggestions even if a key is set. Also used automatically when no key exists.
    mock_llm: bool = False
    database_path: Path = REPO_ROOT / "backend" / "data" / "iris.db"
    cors_origins: list[str] = ["http://localhost:5173"]

    # --- Meta "Muse Voice Transcribe" speech-to-text (used by /api/stt/stream) ---
    # Key from the Meta Model API dashboard. Same variable name Meta's SDKs use.
    model_api_key: str = ""
    muse_url: str = "wss://api.meta.ai/v1/asr/realtime"
    muse_model: str = "muse-voice-transcribe-1.0"
    # Meta's docs disagree on whether the token needs a "Bearer " prefix (their cookbook
    # sends the raw key, the protocol page shows "Bearer ..."). Flip this if the handshake
    # is rejected with close code 1008.
    muse_bearer_prefix: bool = False
    # Log every raw event from Muse (transcripts included). For debugging the protocol only.
    stt_debug: bool = False

    # --- ElevenLabs Voice Cloning & Expressive Emotional TTS (/api/voice/*) ---
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = ""
    elevenlabs_model: str = "eleven_multilingual_v2"

    @property
    def use_mock_llm(self) -> bool:
        return self.mock_llm or not self.anthropic_api_key


def get_settings() -> Settings:
    return Settings()
