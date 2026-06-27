"""Twilio warm transfer via LiveKit SIP.

Flow:
  1. Generate a short spoken handoff summary of the call so far.
  2. Dial the human agent's phone into a private transfer room via the SIP outbound trunk.
  3. A briefing agent greets the human, reads the summary, and asks if they can take it.
  4. ACCEPT -> move the human into the caller's room; Agent A says goodbye and leaves.
     DECLINE/timeout/failure -> tear down; Agent A returns to the caller (team unavailable).
"""
import asyncio
import time
from typing import Awaitable, Callable

from livekit import api, rtc
from livekit.agents import Agent, AgentSession, JobContext, RunContext, function_tool
from livekit.plugins import deepgram, elevenlabs, groq

import config
from monitoring import Monitor
from summary import generate_handoff, transcript_from_history


class _BriefingAgent(Agent):
    def __init__(self, handoff: str, result: asyncio.Future) -> None:
        super().__init__(
            instructions=(
                "You are an internal assistant briefing a human colleague who just answered the "
                f"phone. Speak briefly and naturally. First say: \"{handoff}\" Then ask if they can "
                "take the call right now. If they agree (yes / sure / put them through), call "
                "accept_call. If they decline or can't, call decline_call. Keep it short."
            )
        )
        self._result = result

    @function_tool()
    async def accept_call(self, context: RunContext) -> str:
        if not self._result.done():
            self._result.set_result(True)
        return "Great, connecting them now."

    @function_tool()
    async def decline_call(self, context: RunContext) -> str:
        if not self._result.done():
            self._result.set_result(False)
        return "No problem, thanks."


def make_transfer_handler(
    ctx: JobContext,
    session: AgentSession,
    monitor: Monitor,
    end_call: Callable[[str], Awaitable[None]],
) -> Callable[[str], Awaitable[str]]:
    """Return an async request_transfer(reason) -> 'ACCEPTED' | <message for the caller>."""

    async def request_transfer(reason: str) -> str:
        if not config.transfer_configured():
            await monitor.set(action="", status="connected")
            return "No human is available right now. Apologize and offer to keep helping."

        transfer_room = f"transfer-{ctx.room.name}-{int(time.time())}"
        handoff = await generate_handoff(transcript_from_history(session.history), reason)

        brief_room = rtc.Room()
        result: asyncio.Future[bool] = asyncio.get_event_loop().create_future()
        brief_session = AgentSession(
            stt=deepgram.STT(api_key=config.DEEPGRAM_API_KEY, model="nova-2-phonecall"),
            llm=groq.LLM(api_key=config.GROQ_API_KEY, model=config.GROQ_MODEL),
            tts=elevenlabs.TTS(api_key=config.ELEVENLABS_API_KEY),
        )

        accepted = False
        try:
            token = (
                api.AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET)
                .with_identity("briefing-agent")
                .with_name("Briefing Agent")
                .with_grants(
                    api.VideoGrants(
                        room_join=True, room=transfer_room, can_publish=True, can_subscribe=True
                    )
                )
                .to_jwt()
            )
            await brief_room.connect(config.LIVEKIT_URL, token)
            await brief_session.start(room=brief_room, agent=_BriefingAgent(handoff, result))

            await monitor.event("transfer_dialing", config.HUMAN_AGENT_PHONE_NUMBER)
            await ctx.api.sip.create_sip_participant(
                api.CreateSIPParticipantRequest(
                    sip_trunk_id=config.SIP_OUTBOUND_TRUNK_ID,
                    sip_call_to=config.HUMAN_AGENT_PHONE_NUMBER,
                    room_name=transfer_room,
                    participant_identity="human",
                    participant_name="Human Agent",
                    wait_until_answered=True,
                )
            )
            await monitor.event("transfer_connected", "human answered")
            await brief_session.generate_reply(
                instructions="Greet the colleague and give the briefing now."
            )
            try:
                accepted = await asyncio.wait_for(result, timeout=60)
            except asyncio.TimeoutError:
                accepted = False
            await asyncio.sleep(1.2)  # let the briefing agent's closing line play out
        except Exception as e:  # noqa: BLE001 - surface dial/connect failures to the dashboard
            accepted = False
            await monitor.event("transfer_failed", str(e)[:140])

        if accepted:
            try:
                await ctx.api.room.move_participant(
                    api.MoveParticipantRequest(
                        room=transfer_room,
                        identity="human",
                        destination_room=ctx.room.name,
                    )
                )
            except Exception as e:  # noqa: BLE001
                await monitor.event("transfer_failed", f"move: {str(e)[:120]}")
                accepted = False

        await _safe_close(brief_session, brief_room)

        if accepted:
            await monitor.set(status="transferring", action="connected to human")
            await monitor.event("transfer_accepted", "human took the call")
            await session.say("You're now connected to my colleague who can help. Take care!")
            await end_call("transferred (accepted)")

            async def _leave() -> None:
                await asyncio.sleep(0.5)
                await ctx.room.disconnect()

            asyncio.create_task(_leave())
            return "ACCEPTED"

        await monitor.set(status="connected", action="")
        await monitor.event("transfer_declined", "team unavailable")
        return "The team isn't available right now. Apologize and offer to keep helping the caller."

    return request_transfer


async def _safe_close(session: AgentSession, room: rtc.Room) -> None:
    try:
        await session.aclose()
    except Exception:  # noqa: BLE001
        pass
    try:
        await room.disconnect()
    except Exception:  # noqa: BLE001
        pass
