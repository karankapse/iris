import io
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_voice_profile_empty_by_default(client):
    res = client.get("/api/voice/profile/local-user")
    assert res.status_code == 200
    data = res.json()
    assert data["user_id"] == "local-user"
    assert data["voice_id"] is None
    assert data["configured"] is False


def test_voice_clone_rejects_under_30_seconds(client):
    # Enforces minimum 30 seconds of clear speech
    audio_data = io.BytesIO(b"dummy audio content" * 100)
    res = client.post(
        "/api/voice/clone",
        data={"name": "Nishanth", "user_id": "local-user", "duration": 22.5},
        files={"file": ("sample.mp3", audio_data, "audio/mpeg")},
    )
    assert res.status_code == 400
    assert "30 seconds" in res.json()["detail"]


def test_voice_clone_requires_api_key(client):
    audio_data = io.BytesIO(b"dummy audio content" * 100)
    res = client.post(
        "/api/voice/clone",
        data={"name": "Nishanth", "user_id": "local-user", "duration": 35.0},
        files={"file": ("sample.mp3", audio_data, "audio/mpeg")},
    )
    assert res.status_code == 400
    assert "ELEVENLABS_API_KEY" in res.json()["detail"]


def test_voice_clone_success_with_mocked_elevenlabs(tmp_path):
    settings = Settings(
        database_path=tmp_path / "test_voice.db",
        elevenlabs_api_key="mock-key-12345",
    )
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"voice_id": "eleven_cloned_999"}

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp
        with TestClient(create_app(settings)) as c:
            audio_data = io.BytesIO(b"dummy clear speech audio" * 100)
            res = c.post(
                "/api/voice/clone",
                data={"name": "My Cloned Voice", "user_id": "u42", "duration": 45.0},
                files={"file": ("speech.mp3", audio_data, "audio/mpeg")},
            )
            assert res.status_code == 200
            body = res.json()
            assert body["voice_id"] == "eleven_cloned_999"
            assert body["name"] == "My Cloned Voice"

            # Profile now returns saved voice
            prof_res = c.get("/api/voice/profile/u42")
            assert prof_res.status_code == 200
            assert prof_res.json()["voice_id"] == "eleven_cloned_999"


def test_voice_speak_applies_emotion_sliders(tmp_path):
    settings = Settings(
        database_path=tmp_path / "test_voice.db",
        elevenlabs_api_key="mock-key-12345",
        elevenlabs_voice_id="default_voice_123",
    )

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.aclose = AsyncMock()

    async def fake_aiter_bytes():
        yield b"fake-mp3-audio-chunk"

    mock_resp.aiter_bytes = fake_aiter_bytes

    with patch("httpx.AsyncClient.send", new_callable=AsyncMock) as mock_send:
        mock_send.return_value = mock_resp
        with TestClient(create_app(settings)) as c:
            res = c.post(
                "/api/voice/speak",
                json={
                    "text": "I am so happy to see you",
                    "emotion": "happy",
                    "voice_id": "default_voice_123",
                },
            )
            assert res.status_code == 200
            assert res.headers["content-type"] == "audio/mpeg"
            assert res.content == b"fake-mp3-audio-chunk"
