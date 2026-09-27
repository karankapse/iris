import os

import pytest
from fastapi.testclient import TestClient

import app.services.email as email_module
from app.config import Settings
from app.main import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Fresh temp DB per test; isolate from developer's local .env keys
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    monkeypatch.setenv("MODEL_API_KEY", "")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "")
    monkeypatch.setenv("DATABASE_URL", "")
    # TEST_DATABASE_URL=postgresql://... runs the suite on Postgres (emptied before each test)
    pg = os.environ.get("TEST_DATABASE_URL", "")
    if pg:
        import psycopg

        with psycopg.connect(pg, autocommit=True) as conn:
            conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
    settings = Settings(
        database_path=tmp_path / "test.db",
        database_url=pg,
        anthropic_api_key="",
        model_api_key="",
        elevenlabs_api_key="",
        elevenlabs_voice_id="",
    )
    with TestClient(create_app(settings)) as c:
        yield c


@pytest.fixture(autouse=True)
def outbox(monkeypatch):
    """Every test: emails are captured here, never sent (and SMTP is switched off as a backstop)."""
    sent: list[dict] = []
    monkeypatch.setenv("SMTP_HOST", "")
    monkeypatch.setenv("BREVO_API_KEY", "")

    def fake_send(settings, to, subject, body, html=None):
        sent.append({"to": to, "subject": subject, "body": body, "html": html})
        return True

    monkeypatch.setattr(email_module, "send_email", fake_send)
    return sent
