import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Fresh temp DB per test; isolate from developer's local .env keys
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    monkeypatch.setenv("MODEL_API_KEY", "")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "")
    settings = Settings(
        database_path=tmp_path / "test.db",
        anthropic_api_key="",
        model_api_key="",
        elevenlabs_api_key="",
        elevenlabs_voice_id="",
    )
    with TestClient(create_app(settings)) as c:
        yield c
