"""Speech-to-text relay: browser microphone audio -> Muse Voice Transcribe -> text.

WHY A RELAY? Meta's docs say browser code is visible to users and API keys must not be
embedded in it. So the browser talks to us, and only this server holds MODEL_API_KEY.

PRIVACY (please read): audio is forwarded from memory to Meta and is never written to disk or
logged by this server. But it DOES leave your machine to reach Meta's cloud. The browser
never uploads video anywhere; only microphone audio goes through this route.
"""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from app.config import get_settings
from app.services.muse import build_handshake, normalize_event

log = logging.getLogger("iris.stt")
router = APIRouter(prefix="/api/stt", tags=["speech-to-text"])


async def _fail(ws: WebSocket, message: str, code: int) -> None:
    await ws.send_json({"type": "error", "message": message})
    await ws.close(code=code)


@router.websocket("/stream")
async def stream(ws: WebSocket) -> None:
    settings = get_settings()

    # Browsers don't apply CORS to WebSockets, so without this check ANY web page the user
    # visits could connect to localhost and spend the user's Meta credits. Only allow our app.
    origin = ws.headers.get("origin")
    if origin is not None and origin not in settings.cors_origins:
        await ws.close(code=1008)
        return

    await ws.accept()
    if not settings.model_api_key:
        await _fail(ws, "MODEL_API_KEY is not set on the backend (see .env.example).", 1008)
        return

    try:
        async with connect(settings.muse_url, max_size=2**20) as upstream:
            await upstream.send(build_handshake(settings))

            async def browser_to_muse() -> None:
                while True:
                    message = await ws.receive()
                    if message["type"] == "websocket.disconnect":
                        return
                    if message.get("bytes") is not None:
                        await upstream.send(message["bytes"])  # raw PCM, passed straight through
                    elif message.get("text"):
                        try:
                            if json.loads(message["text"]).get("type") == "endStream":
                                await upstream.send(json.dumps({"type": "endStream"}))
                        except (ValueError, AttributeError):
                            pass

            async def muse_to_browser() -> None:
                async for raw in upstream:
                    event = normalize_event(raw, settings.stt_debug)
                    if event:
                        await ws.send_json(event)

            tasks = [asyncio.create_task(browser_to_muse()), asyncio.create_task(muse_to_browser())]
            _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
    except ConnectionClosed as e:
        log.warning(
            "Muse closed the connection: %s %s",
            e.rcvd.code if e.rcvd else "",
            e.rcvd.reason if e.rcvd else "",
        )
        await _fail(
            ws, f"Muse closed the connection (code {e.rcvd.code if e.rcvd else '?'}).", 1011
        )
        return
    except OSError as e:
        await _fail(ws, f"Could not reach Muse: {type(e).__name__}", 1011)
        return

    try:
        await ws.close()
    except RuntimeError:
        pass  # the browser already went away


@router.websocket("/whisper")
async def whisper_stream(ws: WebSocket) -> None:
    """Local offline Whisper STT. Receives raw PCM chunks and streams text back."""
    await ws.accept()
    await ws.send_json({"type": "ready"})

    from app.services.whisper_local import transcribe_audio

    audio_buffer = bytearray()
    silence_chunks = 0
    SILENCE_THRESHOLD = 500  # Adjust based on microphone volume
    MAX_SILENCE_CHUNKS = 15  # ~1.2 seconds of silence (80ms * 15)

    try:
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                break

            if message.get("bytes") is not None:
                chunk = message["bytes"]
                audio_buffer.extend(chunk)

                # Check energy to detect silence
                import numpy as np

                samples = np.frombuffer(chunk, dtype=np.int16)
                energy = np.sqrt(np.mean(samples.astype(np.float32) ** 2))

                if energy < SILENCE_THRESHOLD:
                    silence_chunks += 1
                else:
                    silence_chunks = 0

                # If we've hit enough silence AND we have audio, transcribe it!
                if (
                    silence_chunks >= MAX_SILENCE_CHUNKS and len(audio_buffer) > 16000 * 0.5 * 2
                ):  # At least 0.5s of audio
                    pcm_data = bytes(audio_buffer)
                    audio_buffer.clear()
                    silence_chunks = 0

                    # Send an interim status so the UI knows it's thinking
                    await ws.send_json({"type": "status", "message": "transcribing..."})

                    text = await transcribe_audio(pcm_data)
                    if text and any(c.isalpha() for c in text):  # Ignore blank or noise-only
                        await ws.send_json({"type": "transcript", "text": text, "final": True})

    except Exception as e:
        log.error(f"Whisper STT error: {e}")
        try:
            await ws.close()
        except RuntimeError:
            pass  # the browser already went away
