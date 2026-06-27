"""Post-call summary generation via Groq."""
from groq import AsyncGroq

from config import GROQ_API_KEY, GROQ_MODEL

_SYS = (
    "You write concise post-call summaries for a clinic receptionist line. "
    "Given the transcript, produce 4-6 short bullet points covering: caller intent, "
    "details collected (name, reason, date/time, phone if present), the outcome "
    "(booked + confirmation code / transferred / cancelled / no action), and any follow-up needed. "
    "Be factual; do not invent details."
)


def transcript_from_history(history) -> str:
    """Render a LiveKit ChatContext history into a readable transcript."""
    lines: list[str] = []
    for item in history.items:
        role = getattr(item, "role", None)
        if role not in ("user", "assistant"):
            continue
        text = getattr(item, "text_content", None)
        if not text:
            continue
        speaker = "Caller" if role == "user" else "Agent"
        lines.append(f"{speaker}: {text}")
    return "\n".join(lines)


_HANDOFF_SYS = (
    "You brief a human agent who is about to take over a live phone call. In 1-2 short, spoken "
    "sentences, summarize who is calling and what they need so the human can step in. "
    "Plain spoken English, no bullet points, no preamble."
)


async def generate_handoff(transcript: str, reason: str) -> str:
    client = AsyncGroq(api_key=GROQ_API_KEY)
    user = f"Reason for transfer: {reason}\n\nTranscript so far:\n{transcript or '(no transcript yet)'}"
    resp = await client.chat.completions.create(
        model=GROQ_MODEL,
        temperature=0.3,
        messages=[{"role": "system", "content": _HANDOFF_SYS}, {"role": "user", "content": user}],
    )
    return resp.choices[0].message.content.strip()


async def generate_summary(transcript: str, outcome: str = "") -> str:
    if not transcript.strip():
        return "No conversation took place."
    client = AsyncGroq(api_key=GROQ_API_KEY)
    user = transcript
    if outcome:
        user += f"\n\n[Call outcome: {outcome}]"
    resp = await client.chat.completions.create(
        model=GROQ_MODEL,
        temperature=0.2,
        messages=[{"role": "system", "content": _SYS}, {"role": "user", "content": user}],
    )
    return resp.choices[0].message.content.strip()
