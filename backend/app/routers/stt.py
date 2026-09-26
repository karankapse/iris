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
