"""Populate the availability table with open slots for the next few days.

Run:  python seed.py
"""
import asyncio
from datetime import date, timedelta

from config import DB_PATH
from db import init_db, _conn

SLOT_TIMES = ["09:00", "09:30", "10:00", "10:30", "11:00", "14:00", "14:30", "15:00", "15:30", "16:00"]
DAYS_AHEAD = 7


def seed() -> None:
    asyncio.run(init_db())
    today = date.today()
    inserted = 0
    with _conn() as c:
        for d in range(DAYS_AHEAD):
            day = today + timedelta(days=d)
            if day.weekday() >= 5:  # skip weekends
                continue
            for t in SLOT_TIMES:
                cur = c.execute(
                    "INSERT OR IGNORE INTO availability (date, time, is_booked) VALUES (?,?,0)",
                    (day.isoformat(), t),
                )
                inserted += cur.rowcount
    print(f"Seeded {inserted} open slots into {DB_PATH}")


if __name__ == "__main__":
    seed()
