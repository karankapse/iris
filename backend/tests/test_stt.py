"""Tests for the Muse speech-to-text relay.

A real (local) WebSocket server plays the part of Meta's API, so we exercise the actual
`websockets` client code instead of a mock.
"""

import json
import threading

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from websockets.sync.server import serve

from app.config import Settings
from app.main import create_app
from app.services.muse import build_handshake, normalize_event

ORIGIN = {"origin": "http://localhost:5173"}


class FakeMuse:
    """Records what the relay sends and replies like Muse would."""

    def __init__(self):
        self.handshake = None
        self.audio_bytes = 0
        self.got_end_stream = threading.Event()

    def handle(self, ws):
        self.handshake = json.loads(ws.recv())
        ws.send(json.dumps({"sessionId": "s1"}))
        for message in ws:
            if isinstance(message, bytes):
                self.audio_bytes += len(message)
                ws.send(json.dumps({"type": "transcript", "transcript": "are", "final": False}))
                ws.send(json.dumps({"type": "speechComplete", "transcript": "are you hungry"}))
                ws.send(json.dumps({"type": "speaker", "label": "A", "turnId": 1}))  # ignored
            elif json.loads(message).get("type") == "endStream":
                self.got_end_stream.set()
                return


@pytest.fixture
def fake_muse(monkeypatch):
    muse = FakeMuse()
    server = serve(muse.handle, "127.0.0.1", 0)
    port = server.socket.getsockname()[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("MUSE_URL", f"ws://127.0.0.1:{port}")
    monkeypatch.setenv("MODEL_API_KEY", "test-key")
    yield muse
    server.shutdown()


def test_relays_audio_up_and_transcripts_down(client, fake_muse):
    with client.websocket_connect("/api/stt/stream", headers=ORIGIN) as ws:
        assert ws.receive_json() == {"type": "ready"}
        ws.send_bytes(b"\x00\x01" * 1280)  # one 80 ms chunk of 16 kHz audio
        assert ws.receive_json() == {"type": "transcript", "text": "are", "final": False}
        assert ws.receive_json() == {"type": "transcript", "text": "are you hungry", "final": True}
        ws.send_text(json.dumps({"type": "endStream"}))
        assert fake_muse.got_end_stream.wait(timeout=3)

    assert fake_muse.audio_bytes == 2560  # passed through untouched


def test_handshake_carries_key_and_expected_settings(client, fake_muse):
    with client.websocket_connect("/api/stt/stream", headers=ORIGIN) as ws:
        ws.receive_json()
    hs = fake_muse.handshake
    assert hs["authorization"] == {"accessToken": "test-key"}
    assert hs["mode"] == "ENDPOINTING"
    assert hs["audioEncoding"] == "PCM_16KHZ"
    assert hs["model"] == "muse-voice-transcribe-1.0"
    assert hs["partialMode"] == "CUMULATIVE"


def test_reports_missing_api_key(client, monkeypatch):
    monkeypatch.setenv("MODEL_API_KEY", "")
    with client.websocket_connect("/api/stt/stream", headers=ORIGIN) as ws:
        event = ws.receive_json()
        assert event["type"] == "error"
        assert "MODEL_API_KEY" in event["message"]


def test_rejects_foreign_origins(client, fake_muse):
    """A random website must not be able to use the user's Meta key through localhost."""
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            "/api/stt/stream", headers={"origin": "https://evil.example"}
        ):
            pass


def test_health_reports_whether_stt_is_configured(client, tmp_path):
    assert client.get("/api/health").json()["stt_configured"] is False  # fixture has no key

    configured = create_app(Settings(database_path=tmp_path / "b.db", model_api_key="x"))
    with TestClient(configured) as c:
        assert c.get("/api/health").json()["stt_configured"] is True


class TestNormalizeEvent:
    def test_partials_are_never_final(self):
        raw = json.dumps({"type": "transcript", "transcript": " hi there ", "final": True})
        assert normalize_event(raw) == {"type": "transcript", "text": "hi there", "final": False}

    def test_speech_complete_is_the_finished_sentence(self):
        raw = json.dumps(
            {"type": "speechComplete", "turnId": 0, "transcript": "Are you hungry? I made pasta"}
        )
        assert normalize_event(raw) == {
            "type": "transcript",
            "text": "Are you hungry? I made pasta",
            "final": True,
        }

    def test_ack_has_session_id_and_no_type(self):
        assert normalize_event(json.dumps({"sessionId": "abc"})) == {"type": "ready"}

    def test_error(self):
        assert normalize_event(json.dumps({"type": "error", "message": "bad"})) == {
            "type": "error",
            "message": "bad",
        }

    @pytest.mark.parametrize(
        "raw",
        [
            "not json",
            "[]",
            json.dumps({"type": "transcript", "transcript": "  ", "final": True}),
            json.dumps({"type": "speaker", "label": "A"}),
        ],
    )
    def test_ignores_everything_else(self, raw):
        assert normalize_event(raw) is None


def test_bearer_prefix_is_optional():
    plain = json.loads(build_handshake(Settings(model_api_key="k")))
    prefixed = json.loads(build_handshake(Settings(model_api_key="k", muse_bearer_prefix=True)))
    assert plain["authorization"]["accessToken"] == "k"
    assert prefixed["authorization"]["accessToken"] == "Bearer k"
