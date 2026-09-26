"""ElevenLabs Voice Banking and Expressive Emotional TTS relay.

Allows uploading speech audio of the user (min 30s) to clone their voice via
ElevenLabs, then synthesizing speech where facial emotion drives stability,
style, speed, and pitch sliders dynamically.
"""

from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import get_settings

router = APIRouter(prefix="/api/voice", tags=["voice"])

MIN_AUDIO_DURATION_SECONDS = 30.0

EMOTIONS = Literal["neutral", "happy", "sad", "excited", "joking", "serious"]


def _get_settings(request: Request):
    return getattr(request.app.state, "settings", None) or get_settings()


# Emotion-to-slider mapping for ElevenLabs Multilingual v2
EMOTION_SLIDERS: dict[str, dict[str, float]] = {
    # Balanced, natural everyday speech
    "neutral": {"stability": 0.50, "similarity_boost": 0.80, "style": 0.10, "speed": 1.00},
    # Lively, energetic, lower stability for pitch swings, high style for brightness
    "happy": {"stability": 0.30, "similarity_boost": 0.80, "style": 0.65, "speed": 1.10},
    # Vibrant, enthusiastic, expressive pitch variation and pace
    "excited": {"stability": 0.25, "similarity_boost": 0.80, "style": 0.75, "speed": 1.15},
    # Subdued, slower tempo, slightly higher stability to sound softer and controlled
    "sad": {"stability": 0.75, "similarity_boost": 0.80, "style": 0.15, "speed": 0.85},
    # Playful, fast inflection, high style exaggeration
    "joking": {"stability": 0.25, "similarity_boost": 0.80, "style": 0.70, "speed": 1.15},
    # Authoritative, grounded, steady tempo
    "serious": {"stability": 0.80, "similarity_boost": 0.85, "style": 0.05, "speed": 0.95},
}


class SpeakRequest(BaseModel):
    text: str
    emotion: EMOTIONS = "neutral"
    voice_id: str | None = None
    user_id: str = "local-user"


class VoiceProfileResponse(BaseModel):
    user_id: str
    voice_id: str | None
    name: str | None
    configured: bool


@router.get("/profile/{user_id}", response_model=VoiceProfileResponse)
async def get_profile(user_id: str, request: Request) -> VoiceProfileResponse:
    settings = _get_settings(request)
    profile = request.app.state.db.get_voice_profile(user_id)
    if profile:
        return VoiceProfileResponse(
            user_id=user_id,
            voice_id=profile["voice_id"],
            name=profile["name"],
            configured=bool(settings.elevenlabs_api_key),
        )
    return VoiceProfileResponse(
        user_id=user_id,
        voice_id=settings.elevenlabs_voice_id or None,
        name="Default Cloned Voice" if settings.elevenlabs_voice_id else None,
        configured=bool(settings.elevenlabs_api_key),
    )


@router.post("/clone")
async def clone_voice(
    request: Request,
    name: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    user_id: Annotated[str, Form()] = "local-user",
    duration: Annotated[float | None, Form()] = None,
) -> dict:
    settings = _get_settings(request)

    # Enforce minimum 30 seconds of clear speech
    if duration is not None and duration < MIN_AUDIO_DURATION_SECONDS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Audio sample duration ({duration:.1f}s) is too short. "
                f"At least {int(MIN_AUDIO_DURATION_SECONDS)} seconds of clear speech "
                "is required for voice cloning."
            ),
        )

    if not settings.elevenlabs_api_key:
        raise HTTPException(
            status_code=400,
            detail="ELEVENLABS_API_KEY is not set on the backend. Please add it to your .env file.",
        )

    audio_bytes = await file.read()
    if len(audio_bytes) < 1024:
        raise HTTPException(
            status_code=400,
            detail="The uploaded audio file is empty or corrupted.",
        )

    url = "https://api.elevenlabs.io/v1/voices/add"
    headers = {"xi-api-key": settings.elevenlabs_api_key}
    data = {
        "name": name,
        "description": f"Iris assistive voice clone for {user_id}",
    }
    files = {
        "files": (
            file.filename or "speech.mp3",
            audio_bytes,
            file.content_type or "audio/mpeg",
        )
    }

    async with httpx.AsyncClient(timeout=90.0) as client:
        try:
            resp = await client.post(url, headers=headers, data=data, files=files)
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to communicate with ElevenLabs: {e}",
            ) from e

        if resp.status_code != 200:
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"ElevenLabs error ({resp.status_code}): {resp.text}",
            )

        result = resp.json()
        voice_id = result.get("voice_id")
        if not voice_id:
            raise HTTPException(
                status_code=502,
                detail="ElevenLabs response did not include a voice_id.",
            )

        request.app.state.db.set_voice_profile(user_id, voice_id, name)
        return {
            "user_id": user_id,
            "voice_id": voice_id,
            "name": name,
            "status": "ok",
        }


@router.post("/speak")
async def speak(req: SpeakRequest, request: Request):
    settings = _get_settings(request)

    # Determine voice ID
    voice_id = req.voice_id
    if not voice_id:
        profile = request.app.state.db.get_voice_profile(req.user_id)
        if profile:
            voice_id = profile["voice_id"]
        else:
            voice_id = settings.elevenlabs_voice_id or None

    if not voice_id:
        raise HTTPException(
            status_code=400,
            detail="No voice_id configured. Please clone or set a voice in Iris Set up.",
        )

    if not settings.elevenlabs_api_key:
        raise HTTPException(
            status_code=400,
            detail="ELEVENLABS_API_KEY is not set on the backend. Please add it to .env.",
        )

    sliders = EMOTION_SLIDERS.get(req.emotion, EMOTION_SLIDERS["neutral"])

    # Punctuation styling for extra expressiveness
    styled_text = req.text.strip()
    if req.emotion in ("happy", "excited") and not styled_text.endswith("!"):
        styled_text += "!"
    elif req.emotion == "sad" and not (styled_text.endswith("...") or styled_text.endswith(".")):
        styled_text += "..."

    client = httpx.AsyncClient(timeout=30.0)
    try:
        upstream_req = client.build_request(
            "POST",
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream",
            headers={
                "xi-api-key": settings.elevenlabs_api_key,
                "Content-Type": "application/json",
            },
            json={
                "text": styled_text,
                "model_id": settings.elevenlabs_model,
                "voice_settings": sliders,
            },
        )
        upstream_res = await client.send(upstream_req, stream=True)
    except Exception as e:
        await client.aclose()
        raise HTTPException(
            status_code=502,
            detail=f"Failed to communicate with ElevenLabs TTS: {e}",
        ) from e

    if upstream_res.status_code != 200:
        err_bytes = await upstream_res.aread()
        await upstream_res.aclose()
        await client.aclose()
        raise HTTPException(
            status_code=upstream_res.status_code,
            detail=f"ElevenLabs TTS error: {err_bytes.decode('utf-8', errors='ignore')}",
        )

    async def audio_stream():
        try:
            async for chunk in upstream_res.aiter_bytes():
                yield chunk
        finally:
            if hasattr(upstream_res, "aclose"):
                close_res = upstream_res.aclose()
                if hasattr(close_res, "__await__"):
                    await close_res
            await client.aclose()

    return StreamingResponse(audio_stream(), media_type="audio/mpeg")
