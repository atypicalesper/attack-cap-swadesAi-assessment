"""Environment configuration for the voice agent backend."""
import os

from dotenv import load_dotenv

load_dotenv()


def _require(name: str) -> str:
    val = os.getenv(name)
    if not val:
        raise RuntimeError(f"Missing required env var: {name}")
    return val


# LiveKit
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")

# LLM / STT / TTS
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

# Twilio / SIP warm transfer
SIP_OUTBOUND_TRUNK_ID = os.getenv("SIP_OUTBOUND_TRUNK_ID", "")
HUMAN_AGENT_PHONE_NUMBER = os.getenv("HUMAN_AGENT_PHONE_NUMBER", "")

# SQLite
DB_PATH = os.getenv("DB_PATH", os.path.join(os.path.dirname(__file__), "appointments.db"))


def transfer_configured() -> bool:
    return bool(SIP_OUTBOUND_TRUNK_ID and HUMAN_AGENT_PHONE_NUMBER)
