"""Agent A worker: the conversational voice receptionist.

Run the worker:   python agent.py dev
"""
import asyncio
import logging

from livekit import agents, rtc
from livekit.agents import AgentSession, RoomInputOptions
from livekit.plugins import deepgram, elevenlabs, groq

import config
import db
from monitoring import Monitor
from summary import generate_summary, transcript_from_history
from tools import Assistant, CallData
from transfer import make_transfer_handler

logger = logging.getLogger("agent")


async def entrypoint(ctx: agents.JobContext) -> None:
    await db.init_db()
    await ctx.connect()

    monitor = Monitor(ctx.room)
    data = CallData(monitor=monitor)

    session = AgentSession(
        userdata=data,
        stt=deepgram.STT(api_key=config.DEEPGRAM_API_KEY, model="nova-3", language="multi"),
        llm=groq.LLM(api_key=config.GROQ_API_KEY, model=config.GROQ_MODEL),
        tts=elevenlabs.TTS(api_key=config.ELEVENLABS_API_KEY),
    )

    state = {"ended": False, "caller": None, "takenover": False}

    async def end_call(outcome: str = "") -> None:
        if state["ended"]:
            return
        state["ended"] = True
        await monitor.set(state="ended", status="ended", action="")
        transcript = transcript_from_history(session.history)
        try:
            text = await generate_summary(transcript, outcome)
        except Exception as e:  # noqa: BLE001
            text = f"(summary unavailable: {e})"
        await db.save_summary(ctx.room.name, text, outcome)
        await monitor.summary(text, outcome)

    data.request_transfer = make_transfer_handler(ctx, session, monitor, end_call)

    # --- monitoring: state + transcript ---
    @session.on("agent_state_changed")
    def _on_state(ev) -> None:
        if not state["ended"] and not state["takenover"]:
            asyncio.create_task(monitor.set(state=ev.new_state))

    @session.on("conversation_item_added")
    def _on_item(ev) -> None:
        item = ev.item
        if getattr(item, "role", None) in ("user", "assistant") and getattr(item, "text_content", None):
            role = "caller" if item.role == "user" else "agent"
            asyncio.create_task(monitor.transcript(role, item.text_content, final=True))

    @session.on("user_input_transcribed")
    def _on_user_tx(ev) -> None:
        if not ev.is_final:  # finals arrive via conversation_item_added
            asyncio.create_task(monitor.transcript("caller", ev.transcript, final=False))

    # --- take-over RPC from the monitoring dashboard ---
    async def _takeover(_data: rtc.RpcInvocationData) -> str:
        state["takenover"] = True
        session.interrupt()
        session.input.set_audio_enabled(False)
        await monitor.set(state="paused", action="watcher in control")
        await monitor.event("takeover", "watcher took control")
        return "ok"

    async def _resume(_data: rtc.RpcInvocationData) -> str:
        state["takenover"] = False
        session.input.set_audio_enabled(True)
        await monitor.set(state="listening", action="")
        await monitor.event("resume", "agent resumed")
        return "ok"

    ctx.room.local_participant.register_rpc_method("takeover", _takeover)
    ctx.room.local_participant.register_rpc_method("resume", _resume)

    # --- detect caller hangup -> end call ---
    def _is_caller(p: rtc.RemoteParticipant) -> bool:
        return p.identity.startswith("caller") or p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP

    for p in ctx.room.remote_participants.values():
        if state["caller"] is None and _is_caller(p):
            state["caller"] = p.identity

    @ctx.room.on("participant_connected")
    def _on_join(p: rtc.RemoteParticipant) -> None:
        if state["caller"] is None and _is_caller(p):
            state["caller"] = p.identity

    @ctx.room.on("participant_disconnected")
    def _on_leave(p: rtc.RemoteParticipant) -> None:
        if p.identity == state["caller"] and not state["ended"]:
            async def _finish() -> None:
                await end_call("caller hung up")
                await asyncio.sleep(0.3)
                await ctx.room.disconnect()

            asyncio.create_task(_finish())

    async def _on_shutdown() -> None:
        await end_call("call ended")

    ctx.add_shutdown_callback(_on_shutdown)

    await session.start(room=ctx.room, agent=Assistant(), room_input_options=RoomInputOptions())
    await monitor.set(state="listening", status="connected", action="")
    await session.generate_reply(
        instructions=(
            "Greet the caller warmly as Agent A from Northside Health Clinic, in a natural, "
            "friendly tone — not a scripted-sounding intro — and ask how you can help."
        )
    )


if __name__ == "__main__":
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))
