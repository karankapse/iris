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

    @property
    def use_mock_llm(self) -> bool:
        return self.mock_llm or not self.anthropic_api_key


def get_settings() -> Settings:
    return Settings()
