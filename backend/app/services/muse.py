"""Protocol helpers for Meta's Muse Voice Transcribe realtime API.

Docs: https://dev.meta.ai/docs/api-reference/voice/realtime
Endpoint: wss://api.meta.ai/v1/asr/realtime

Conversation with the API:
  1. we send ONE JSON text frame (the "handshake") with the credential and settings
  2. we stream raw audio as binary frames: mono 16-bit PCM, little-endian
  3. Muse sends JSON events back: partial transcripts (final=false), then a final one
  4. we send {"type": "endStream"} when we're done sending audio
"""

import json
import logging

from app.config import Settings

log = logging.getLogger("iris.stt")

# The browser resamples to this rate before sending. Must match SAMPLE_RATE in
# frontend/src/modules/conversation/real/audio.ts.
SAMPLE_RATE = 16_000
AUDIO_ENCODING = "PCM_16KHZ"


def build_handshake(settings: Settings) -> str:
    token = settings.model_api_key
    if settings.muse_bearer_prefix:
        token = f"Bearer {token}"
    return json.dumps(
        {
            # ENDPOINTING: the model itself detects where a spoken sentence ends, which is
            # what triggers "generate reply suggestions". (Other modes: PUSH_TO_TALK, DIARIZATION.)
            "mode": "ENDPOINTING",
            "authorization": {"accessToken": token},
            "audioEncoding": AUDIO_ENCODING,
            "model": settings.muse_model,
            # Each partial replaces the previous one (instead of being a delta).
            "partialMode": "CUMULATIVE",
            "emitAudioProgress": False,
        }
    )


def normalize_event(raw: str | bytes, debug: bool = False) -> dict | None:
    """Turn a Muse event into the small message format our browser understands.

      {"type": "ready"}                                  session accepted
      {"type": "transcript", "text": str, "final": bool}
      {"type": "error", "message": str}

    Everything else (speaker labels, audio progress, ...) is ignored for now.
    """
    try:
        event = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(event, dict):
        return None
    if debug:
        log.info("muse event: %s", event)

    kind = event.get("type")
    if kind == "transcript":
        text = str(event.get("transcript") or "").strip()
        if not text:
            return None
        return {"type": "transcript", "text": text, "final": bool(event.get("final"))}
    if kind == "error":
        return {"type": "error", "message": str(event.get("message") or "Muse error")}
    # The handshake acknowledgement has a sessionId and no "type" field.
    if kind in (None, "session") and "sessionId" in event:
        return {"type": "ready"}
    return None
