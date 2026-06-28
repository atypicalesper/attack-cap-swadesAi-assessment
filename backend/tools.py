"""Agent A definition: the conversational assistant and its function tools."""
from dataclasses import dataclass
from datetime import date
from typing import Awaitable, Callable, Optional

from livekit.agents import Agent, RunContext, StopResponse, function_tool

import db
from monitoring import Monitor


@dataclass
class CallData:
    """Per-call state shared across tools, the monitor, and the transfer handler."""
    monitor: Monitor
    name: Optional[str] = None
    reason: Optional[str] = None
    datetime: Optional[str] = None
    phone: Optional[str] = None
    # Set by agent.py; runs the Twilio warm-transfer flow. Returns a result string.
    request_transfer: Optional[Callable[[str], Awaitable[str]]] = None


def _instructions() -> str:
    today = date.today()
    return f"""You are Agent A, the voice receptionist for "Northside Health Clinic". You genuinely
care about the person on the line — talk like a warm, unhurried front-desk human, not a script.
Today's date is {today.isoformat()} ({today.strftime('%A')}). Keep replies short — one or two
sentences — but natural: use contractions, brief acknowledgments ("sure thing", "got it", "no
problem"), and vary your phrasing instead of repeating the same template every turn. Never read
out IDs character by character unless asked, and never sound like you're reciting a menu. If the
caller speaks in a language other than English, switch to that language for the rest of the call
— stay just as warm and natural in it.

Your job:
1. Greet the caller and ask how you can help.
2. To BOOK an appointment, collect: full name, reason for visit, preferred date and time, and a
   contact phone number. As soon as you learn any of these, call `record_details` so they are saved.
3. Before confirming, ALWAYS call `check_availability` for the requested date/time. If the exact
   slot is taken, offer the nearest open slots it returns.
4. Once the caller agrees to a specific open slot, call `book_appointment`. Then read the booking
   back: name, reason, date, time, and the confirmation code.
5. If the caller wants to RESCHEDULE/CANCEL or LOOK UP an appointment, use the matching tool.
6. If the caller asks for a human, mentions billing, has a complaint, or sounds frustrated,
   reassure them warmly, then call `request_human` with a one-line reason. Tell them you're
   connecting them and to hold briefly.

Convert natural dates/times to concrete values: dates as YYYY-MM-DD, times as 24-hour HH:MM.
If something is ambiguous, ask a brief clarifying question. Do not invent availability — rely on
the tools."""


class Assistant(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=_instructions())

    @function_tool()
    async def record_details(
        self,
        context: RunContext[CallData],
        name: Optional[str] = None,
        reason: Optional[str] = None,
        date: Optional[str] = None,
        time: Optional[str] = None,
        phone: Optional[str] = None,
    ) -> str:
        """Save any caller details you have collected so the live dashboard stays up to date.

        Call this whenever you learn the caller's name, reason for visit, preferred date/time,
        or phone number — even partially.
        """
        data = context.userdata
        if name:
            data.name = name
        if reason:
            data.reason = reason
        if date and time:
            data.datetime = f"{date} {time}"
        elif date:
            data.datetime = date
        if phone:
            data.phone = phone
        await data.monitor.set(intent="book")
        await data.monitor.set_collected(
            name=data.name, reason=data.reason, datetime=data.datetime, phone=data.phone
        )
        return "Saved."

    @function_tool()
    async def check_availability(
        self, context: RunContext[CallData], date: str, time: Optional[str] = None
    ) -> str:
        """Check open appointment slots for a date (YYYY-MM-DD), optionally near a time (HH:MM)."""
        mon = context.userdata.monitor
        await mon.set(intent="book", action="checking availability...")
        await mon.event("tool", f"check_availability {date} {time or ''}".strip())
        slots = await db.list_availability(date, time)
        await mon.set(action="")
        if not slots:
            return f"No open slots on {date}. Suggest another day."
        listed = ", ".join(s["time"] for s in slots)
        return f"Open slots on {date}: {listed}."

    @function_tool()
    async def book_appointment(
        self,
        context: RunContext[CallData],
        name: str,
        reason: str,
        date: str,
        time: str,
        phone: str,
    ) -> str:
        """Book a confirmed slot. date=YYYY-MM-DD, time=HH:MM. Only call after check_availability."""
        data = context.userdata
        mon = data.monitor
        data.name, data.reason, data.datetime, data.phone = name, reason, f"{date} {time}", phone
        await mon.set_collected(name=name, reason=reason, datetime=f"{date} {time}", phone=phone)
        await mon.set(intent="book", action="booking...")
        await mon.event("tool", f"book_appointment {date} {time}")
        appt_id = await db.book_slot(name, reason, date, time, phone)
        await mon.set(action="")
        if not appt_id:
            return f"That slot ({date} {time}) was just taken. Ask the caller to pick another."
        await mon.event("booked", appt_id)
        return (
            f"Booked. Confirmation code {appt_id} for {name} on {date} at {time}, reason: {reason}. "
            f"Read this back to the caller."
        )

    @function_tool()
    async def lookup_appointment(self, context: RunContext[CallData], phone: str) -> str:
        """Look up the caller's most recent active appointment by phone number."""
        await context.userdata.monitor.set(intent="lookup", action="looking up...")
        appt = await db.lookup_appointment(phone)
        await context.userdata.monitor.set(action="")
        if not appt:
            return "No active appointment found for that number."
        return (
            f"Found {appt['id']}: {appt['name']} on {appt['date']} at {appt['time']}, "
            f"reason: {appt['reason']}."
        )

    @function_tool()
    async def cancel_appointment(self, context: RunContext[CallData], confirmation_id: str) -> str:
        """Cancel an appointment by its confirmation code and free the slot."""
        await context.userdata.monitor.set(intent="cancel", action="cancelling...")
        ok = await db.cancel_appointment(confirmation_id.strip().upper())
        await context.userdata.monitor.set(action="")
        return "Cancelled and the slot is freed." if ok else "I couldn't find that confirmation code."

    @function_tool()
    async def reschedule_appointment(
        self, context: RunContext[CallData], confirmation_id: str, new_date: str, new_time: str
    ) -> str:
        """Move an existing appointment to a new date/time. new_date=YYYY-MM-DD, new_time=HH:MM.
        Check the new slot with check_availability first if unsure it's open."""
        mon = context.userdata.monitor
        await mon.set(intent="reschedule", action="rescheduling...")
        appt_id = confirmation_id.strip().upper()
        ok = await db.reschedule_appointment(appt_id, new_date, new_time)
        await mon.set(action="")
        if not ok:
            return "I couldn't reschedule — that code wasn't found or the new slot is already taken."
        await mon.event("rescheduled", f"{appt_id} -> {new_date} {new_time}")
        return f"Rescheduled to {new_date} at {new_time}. Confirmation code is still {appt_id}."

    @function_tool()
    async def request_human(self, context: RunContext[CallData], reason: str) -> str:
        """Transfer the caller to a human agent (billing, complaints, or an explicit request)."""
        data = context.userdata
        await data.monitor.set(intent="human", action="transferring...", status="transferring")
        await data.monitor.event("transfer_requested", reason)
        if data.request_transfer is None:
            await data.monitor.set(action="", status="connected")
            return "Transfers aren't available right now; continue helping the caller."
        result = await data.request_transfer(reason)
        if result == "ACCEPTED":
            # Agent A has handed off and is leaving; do not let the LLM speak again.
            raise StopResponse()
        return result
