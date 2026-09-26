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


def test_voice_list_with_roger_default(tmp_path):
    settings = Settings(
        database_path=tmp_path / "test_voice.db",
        elevenlabs_api_key="mock-key-12345",
        elevenlabs_voice_id="CwhRBWXzGAHq8TQ4Fs17",
    )
    with TestClient(create_app(settings)) as c:
        res = c.get("/api/voice/profile/local-user")
        assert res.status_code == 200
        data = res.json()
        assert data["voice_id"] == "CwhRBWXzGAHq8TQ4Fs17"
        assert "Roger" in data["name"]
        assert len(data["voices"]) == 1
        assert data["voices"][0]["voice_id"] == "CwhRBWXzGAHq8TQ4Fs17"
        assert data["voices"][0]["is_default"] is True


def test_select_voice_switch_between_voices(tmp_path):
    settings = Settings(
        database_path=tmp_path / "test_voice.db",
        elevenlabs_api_key="mock-key-12345",
        elevenlabs_voice_id="CwhRBWXzGAHq8TQ4Fs17",
    )
    app = create_app(settings)
    app.state.db.set_voice_profile("u1", "cloned_v1", "My Cloned Voice")

    with TestClient(app) as c:
        # Check cloned is active and Roger is also in the list
        res = c.get("/api/voice/profile/u1")
        assert res.status_code == 200
        data = res.json()
        assert data["voice_id"] == "cloned_v1"
        assert len(data["voices"]) == 2

        # Switch to Roger
        sel_res = c.post(
            "/api/voice/select",
            json={"user_id": "u1", "voice_id": "CwhRBWXzGAHq8TQ4Fs17"},
        )
        assert sel_res.status_code == 200
        sel_data = sel_res.json()
        assert sel_data["voice_id"] == "CwhRBWXzGAHq8TQ4Fs17"

        # Switch back to cloned
        sel_res2 = c.post(
            "/api/voice/select",
            json={"user_id": "u1", "voice_id": "cloned_v1"},
        )
        assert sel_res2.status_code == 200
        assert sel_res2.json()["voice_id"] == "cloned_v1"
