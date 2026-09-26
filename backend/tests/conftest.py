import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Fresh temp DB per test; no API keys -> canned mock suggestions and STT not configured,
    # whatever keys the developer has in their local .env.
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")  # env vars override .env
    settings = Settings(database_path=tmp_path / "test.db", anthropic_api_key="", model_api_key="")
    with TestClient(create_app(settings)) as c:
        yield c
