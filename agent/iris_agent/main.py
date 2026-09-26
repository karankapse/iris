"""The LiveKit agent worker.

It joins the same LiveKit room as the browser, and waits. When the frontend sends a "speak" RPC
(text + tone), it speaks that exact text with Cartesia TTS in that tone, into the room, so the user
and the partner both hear it. Run it with:   cd agent && uv run python -m iris_agent.main dev

What this deliberately does NOT do (see docs/architecture.md):
  - no LLM and no automatic "hear speech -> think -> reply" pipeline
    (Claude's suggestions come from our backend; the user picks one)
  - no LiveKit "expressive mode"
    (the emotion comes from Iris's emotion module and is confirmed by the user)
"""

from pathlib import Path

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, cli
from livekit.plugins import cartesia

from iris_agent.speaker import Speaker
from iris_agent.tone_map import load_tone_map

# One .env at the repo root is shared by the backend, the agent and the frontend.
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

RPC_ERROR_BAD_REQUEST = 2001  # app-defined; LiveKit reserves 1001-1999

server = AgentServer()


@server.rtc_session()  # no agent_name: automatically joins every room that is created
async def entrypoint(ctx: JobContext) -> None:
    tone_map = load_tone_map()
    tts = cartesia.TTS(model=tone_map.model, voice=tone_map.voice)  # reads CARTESIA_API_KEY
    session = AgentSession(tts=tts)  # TTS only: no STT, no LLM
    await session.start(
        agent=Agent(
            instructions="You only speak the exact text you are sent. Never reply on your own."
        ),
        room=ctx.room,
    )

    speaker = Speaker(session, tts, tone_map)

    async def on_speak(data: rtc.RpcInvocationData) -> str:
        try:
            return await speaker.speak(data.payload)
        except ValueError as e:
            raise rtc.RpcError(RPC_ERROR_BAD_REQUEST, str(e)) from e

    async def on_cancel(_data: rtc.RpcInvocationData) -> str:
        return await speaker.cancel()

    local = ctx.room.local_participant
    local.register_rpc_method("speak", on_speak)
    local.register_rpc_method("cancel", on_cancel)
    # Tell the browser we are ready: it waits for this before sending the first "speak".
    await local.set_attributes({"iris.ready": "1"})


if __name__ == "__main__":
    cli.run_app(server)
