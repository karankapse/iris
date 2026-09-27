"""Settings, read from environment variables or the repo-root `.env` file.

The API key lives ONLY here (server side). The browser never sees it: Vite only
exposes variables that start with `VITE_`, and this one doesn't.
"""

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/config.py -> parents[2] is the repo root
REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # an empty variable (e.g. SMTP_PORT= on a host) means "not set": use the default
        env_ignore_empty=True,
    )

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5"
    # A small, fast model for quick yes/no checks (e.g. "is this new speech related?").
    anthropic_fast_model: str = "claude-haiku-4-5"
    # Force canned suggestions even if a key is set. Also used automatically when no key exists.
    mock_llm: bool = False
    # --- Email (welcome, password changed, password reset). Any SMTP server works, e.g. Gmail with
    # an App Password (smtp.gmail.com, port 587). Empty SMTP_HOST = emails are printed to the log.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    email_from: str = ""  # e.g. "Iris <you@gmail.com>"; defaults to smtp_user
    # Where SMTP is blocked (Railway), send through Brevo's HTTPS API instead: set its API key and
    # verify the EMAIL_FROM address in Brevo. Takes priority over SMTP when set.
    brevo_api_key: str = ""
    # Confirm new accounts by email (the normal way). Turn off where no email can be sent yet
    # (REQUIRE_EMAIL_VERIFICATION=false): accounts then work right after signing up.
    require_email_verification: bool = True
    app_url: str = "http://localhost:5173"  # used in links inside emails
    database_path: Path = (
        # Vercel: only /tmp is writable (and temporary): set DATABASE_URL there to keep data
        Path("/tmp/iris.db")
        if os.environ.get("VERCEL")
        else REPO_ROOT / "backend" / "data" / "iris.db"
    )
    # Postgres connection string (deployed). Empty = the SQLite file above.
    database_url: str = ""
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
    elevenlabs_voice_id: str = "CwhRBWXzGAHq8TQ4Fs17"
    elevenlabs_model: str = "eleven_v3"

    @property
    def use_mock_llm(self) -> bool:
        return self.mock_llm or not self.anthropic_api_key


def get_settings() -> Settings:
    return Settings()
