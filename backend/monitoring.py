"""Publishes agent state, collected data, transcript, and lifecycle events to the room.

The Next.js monitoring dashboard reads these:
  - participant attributes  -> discrete state (state / intent / action / status + collected fields)
  - data packets (topic="monitor") -> transcript segments + lifecycle events
"""
import json
import time

from livekit import rtc

MONITOR_TOPIC = "monitor"


class Monitor:
    def __init__(self, room: rtc.Room):
        self._room = room
        self._attrs: dict[str, str] = {
            "state": "connecting",
            "intent": "",
            "action": "",
            "status": "connected",
            "name": "",
            "reason": "",
            "datetime": "",
            "phone": "",
        }

    async def _flush(self) -> None:
        await self._room.local_participant.set_attributes(dict(self._attrs))

    async def set(self, **kwargs) -> None:
        for k, v in kwargs.items():
            self._attrs[k] = "" if v is None else str(v)
        await self._flush()

    async def set_collected(self, *, name=None, reason=None, datetime=None, phone=None) -> None:
        updates = {}
        if name is not None:
            updates["name"] = name
        if reason is not None:
            updates["reason"] = reason
        if datetime is not None:
            updates["datetime"] = datetime
        if phone is not None:
            updates["phone"] = phone
        if updates:
            await self.set(**updates)

    async def _publish(self, payload: dict) -> None:
        payload["ts"] = int(time.time() * 1000)
        await self._room.local_participant.publish_data(
            json.dumps(payload).encode("utf-8"),
            reliable=True,
            topic=MONITOR_TOPIC,
        )

    async def transcript(self, role: str, text: str, final: bool = True) -> None:
        await self._publish({"type": "transcript", "role": role, "text": text, "final": final})

    async def event(self, name: str, detail: str = "") -> None:
        await self._publish({"type": "event", "name": name, "detail": detail})

    async def summary(self, text: str, outcome: str = "") -> None:
        await self._publish({"type": "summary", "text": text, "outcome": outcome})
