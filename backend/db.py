"""SQLite store for availability, appointments, and call summaries.

Each LiveKit agent worker process handles several concurrent calls on one asyncio
event loop, so every query here runs in a worker thread via asyncio.to_thread —
a blocking sqlite3 call on the event loop would stall audio for every other
concurrent call on the same process. WAL mode + a busy timeout let concurrent
worker processes read/write the same file without "database is locked" errors.
"""
import asyncio
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime
from typing import Optional

from config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS availability (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    date      TEXT NOT NULL,          -- YYYY-MM-DD
    time      TEXT NOT NULL,          -- HH:MM (24h)
    is_booked INTEGER NOT NULL DEFAULT 0,
    UNIQUE(date, time)
);

CREATE TABLE IF NOT EXISTS appointments (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    reason     TEXT NOT NULL,
    date       TEXT NOT NULL,
    time       TEXT NOT NULL,
    phone      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'booked'  -- booked | cancelled
);

CREATE TABLE IF NOT EXISTS call_summaries (
    id         TEXT PRIMARY KEY,
    room       TEXT NOT NULL,
    summary    TEXT NOT NULL,
    outcome    TEXT,
    created_at TEXT NOT NULL
);
"""


@contextmanager
def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _init_db() -> None:
    with _conn() as c:
        c.executescript(SCHEMA)


def _list_availability(date: str, time: Optional[str] = None) -> list[dict]:
    with _conn() as c:
        if time:
            rows = c.execute(
                "SELECT date, time FROM availability "
                "WHERE date=? AND is_booked=0 ORDER BY ABS(strftime('%s','2000-01-01 '||time) "
                "- strftime('%s','2000-01-01 '||?)) LIMIT 5",
                (date, time),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT date, time FROM availability WHERE date=? AND is_booked=0 ORDER BY time",
                (date,),
            ).fetchall()
        return [dict(r) for r in rows]


def _is_slot_open(date: str, time: str) -> bool:
    with _conn() as c:
        row = c.execute(
            "SELECT is_booked FROM availability WHERE date=? AND time=?",
            (date, time),
        ).fetchone()
        return row is not None and row["is_booked"] == 0


def _book_slot(name: str, reason: str, date: str, time: str, phone: str) -> Optional[str]:
    appt_id = uuid.uuid4().hex[:8].upper()
    with _conn() as c:
        cur = c.execute(
            "UPDATE availability SET is_booked=1 WHERE date=? AND time=? AND is_booked=0",
            (date, time),
        )
        if cur.rowcount == 0:
            return None
        c.execute(
            "INSERT INTO appointments (id, name, reason, date, time, phone, created_at, status) "
            "VALUES (?,?,?,?,?,?,?, 'booked')",
            (appt_id, name, reason, date, time, phone, datetime.utcnow().isoformat()),
        )
    return appt_id


def _lookup_appointment(phone: str) -> Optional[dict]:
    with _conn() as c:
        row = c.execute(
            "SELECT * FROM appointments WHERE phone=? AND status='booked' "
            "ORDER BY created_at DESC LIMIT 1",
            (phone,),
        ).fetchone()
        return dict(row) if row else None


def _cancel_appointment(appt_id: str) -> bool:
    with _conn() as c:
        row = c.execute("SELECT date, time FROM appointments WHERE id=? AND status='booked'", (appt_id,)).fetchone()
        if not row:
            return False
        c.execute("UPDATE appointments SET status='cancelled' WHERE id=?", (appt_id,))
        c.execute("UPDATE availability SET is_booked=0 WHERE date=? AND time=?", (row["date"], row["time"]))
        return True


def _reschedule_appointment(appt_id: str, new_date: str, new_time: str) -> Optional[str]:
    with _conn() as c:
        row = c.execute(
            "SELECT date, time FROM appointments WHERE id=? AND status='booked'", (appt_id,)
        ).fetchone()
        if not row:
            return None
        if (row["date"], row["time"]) != (new_date, new_time):
            cur = c.execute(
                "UPDATE availability SET is_booked=1 WHERE date=? AND time=? AND is_booked=0",
                (new_date, new_time),
            )
            if cur.rowcount == 0:
                return None
            c.execute(
                "UPDATE availability SET is_booked=0 WHERE date=? AND time=?",
                (row["date"], row["time"]),
            )
        c.execute("UPDATE appointments SET date=?, time=? WHERE id=?", (new_date, new_time, appt_id))
        return appt_id


def _save_summary(room: str, summary: str, outcome: str = "") -> str:
    sid = uuid.uuid4().hex[:8].upper()
    with _conn() as c:
        c.execute(
            "INSERT INTO call_summaries (id, room, summary, outcome, created_at) VALUES (?,?,?,?,?)",
            (sid, room, summary, outcome, datetime.utcnow().isoformat()),
        )
    return sid


async def init_db() -> None:
    await asyncio.to_thread(_init_db)


async def list_availability(date: str, time: Optional[str] = None) -> list[dict]:
    """Return open (un-booked) slots for a date, optionally near a specific time."""
    return await asyncio.to_thread(_list_availability, date, time)


async def is_slot_open(date: str, time: str) -> bool:
    return await asyncio.to_thread(_is_slot_open, date, time)


async def book_slot(name: str, reason: str, date: str, time: str, phone: str) -> Optional[str]:
    """Atomically book a slot. Returns confirmation id, or None if slot unavailable."""
    return await asyncio.to_thread(_book_slot, name, reason, date, time, phone)


async def lookup_appointment(phone: str) -> Optional[dict]:
    return await asyncio.to_thread(_lookup_appointment, phone)


async def cancel_appointment(appt_id: str) -> bool:
    return await asyncio.to_thread(_cancel_appointment, appt_id)


async def reschedule_appointment(appt_id: str, new_date: str, new_time: str) -> Optional[str]:
    """Move a booked appointment to a new date/time. Returns the same id, or None if not found / new slot taken."""
    return await asyncio.to_thread(_reschedule_appointment, appt_id, new_date, new_time)


async def save_summary(room: str, summary: str, outcome: str = "") -> str:
    return await asyncio.to_thread(_save_summary, room, summary, outcome)
