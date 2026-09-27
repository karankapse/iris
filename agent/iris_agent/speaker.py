"""Speaks one confirmed reply. Separate from LiveKit plumbing so it can be tested without a room.

Order matters: before EVERY utterance we set that tone's Cartesia options on the TTS, then say the
exact text. The tone always comes from Iris (the emotion module + the user's confirmation),
never from a language model.
"""

import asyncio
from typing import Any

from iris_agent.speak import parse_speak_request
from iris_agent.tone_map import ToneMap


class Speaker:
    def __init__(self, session: Any, tts: Any, tone_map: ToneMap):
        self._session = session  # a livekit.agents.AgentSession
        self._tts = tts  # the livekit cartesia.TTS used by that session
        self._tone_map = tone_map
        self._lock = asyncio.Lock()  # one reply at a time, so tones can't get mixed up

    async def speak(self, payload: str) -> str:
        """Speak the reply in the payload. Returns when the audio has finished playing."""
        request = parse_speak_request(payload, self._tone_map)
        settings = self._tone_map.settings_for(request.tone, request.speed)
        async with self._lock:
            self._tts.update_options(
                emotion=settings.emotion, speed=settings.speed, volume=settings.volume
            )
            # add_to_chat_ctx=False: there is no conversation with an AI here, just speech out.
            # allow_interruptions=False: the partner talking must not cut the reply off.
            handle = self._session.say(
                request.text, allow_interruptions=False, add_to_chat_ctx=False
            )
            await handle  # resolves when playback is done
        return "done"

    async def cancel(self) -> str:
        """Stop speaking right now (the user pressed cancel while a reply was playing)."""
        await self._session.interrupt(force=True)
        return "cancelled"
