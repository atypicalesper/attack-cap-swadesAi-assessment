# Conversational Voice Agent — Live Monitoring & Warm Transfer

A voice receptionist ("Agent A") for a clinic, built on **LiveKit Agents**. It holds a natural
conversation, books appointments via tool calls, streams everything to a **live monitoring
dashboard** where a watcher can **take over** the call, performs a **warm transfer** to a human
over **Twilio**, and produces a **post-call summary**.

- **Backend** — Python, LiveKit Agents SDK. LLM: **Groq** (`llama-3.3-70b-versatile`),
  STT: **Deepgram**, TTS: **ElevenLabs**, VAD: bundled Silero.
- **Frontend** — Next.js 15 (App Router), React 19, TypeScript, Tailwind v4,
  `@livekit/components-react` + `livekit-client`.
- **Store** — SQLite (`availability`, `appointments`, `call_summaries`).

```
Caller (browser mic) ─┐
                      ├─ LiveKit room ── Agent A (Python worker) ── Groq / Deepgram / ElevenLabs
Watcher (dashboard) ──┘        │                    │
        ▲ attributes + data    │                    └─ tools: check_availability / book / lookup
        │ (state, transcript,  │                          cancel / request_human
        │  collected, summary) │
        │ RPC: takeover/resume │
                               └─ warm transfer ── Twilio SIP ── human agent's phone
```

---

## 1. Prerequisites

Create free accounts and grab keys:

| Service | What you need | Where |
|---|---|---|
| LiveKit Cloud | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | https://cloud.livekit.io |
| Groq | `GROQ_API_KEY` | https://console.groq.com/keys |
| Deepgram | `DEEPGRAM_API_KEY` | https://console.deepgram.com |
| ElevenLabs | `ELEVENLABS_API_KEY` | https://elevenlabs.io (Profile → API key) |
| Twilio | a phone number + an Elastic SIP Trunk (Termination URI + Credential List). Account SID/auth token are only used inside the Twilio Console UI — nothing Twilio-specific is stored in `.env` | https://twilio.com (for warm transfer only) |

Also install the **LiveKit CLI** (`lk`) for the one-time SIP trunk setup: https://docs.livekit.io/home/cli/

Booking, conversation, monitoring, and take-over all work **without Twilio**. Twilio is only
required for the warm-transfer step.

---

## 2. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env        # then fill in your keys
python seed.py              # populate the availability table (next 7 weekdays)
```

Run the agent worker (auto-dispatched to any room a caller joins):

```bash
python agent.py dev
```

Tip: test the agent with just your terminal mic (no frontend, no LiveKit room needed):

```bash
python agent.py console
```

### Environment (`backend/.env`)

```
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
GROQ_API_KEY=...
GROQ_MODEL=llama-3.3-70b-versatile
DEEPGRAM_API_KEY=...
ELEVENLABS_API_KEY=...
# warm transfer (optional):
SIP_OUTBOUND_TRUNK_ID=ST_...
HUMAN_AGENT_PHONE_NUMBER=+1...
```

---

## 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local  # fill in the same LiveKit values
npm run dev                 # http://localhost:3000
```

### Environment (`frontend/.env.local`)

```
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
```

- **`/`** — caller view. Pick a room (default `clinic-demo`), click **Start call**, talk to Agent A.
- **`/monitor`** — monitoring dashboard. Enter the same room, click **Monitor call**.

The `/api/token` route mints LiveKit access tokens with `livekit-server-sdk`. Caller identities are
prefixed `caller-`, watcher identities `watcher-`.

---

## 4. Warm transfer setup (Twilio + LiveKit SIP)

One-time setup to let the agent dial a real phone. Two values come out of this:
`SIP_OUTBOUND_TRUNK_ID` (from LiveKit) and `HUMAN_AGENT_PHONE_NUMBER` (just the phone you want
calls to land on — a cell phone, a teammate's number, whatever the "human agent" answers).

1. **Twilio** → buy/use a phone number, then **Products & Services → Elastic SIP Trunking →
   Trunks → Create new SIP trunk**.
   - **Termination** tab → set a **Termination SIP URI**, e.g. `your-name.pstn.twilio.com`.
   - **Voice → Credential Lists** → create a credential list (pick a username/password), then
     attach it to the trunk's Termination tab under **Authentication**.
   - Attach your Twilio number to the trunk — this becomes the **caller ID** the human sees, not
     the number being dialed.
2. **Install the LiveKit CLI**: `brew install livekit-cli` (or see
   [docs.livekit.io/home/cli](https://docs.livekit.io/home/cli/)), then `lk cloud auth` to log in to
   your project.
3. **Create the LiveKit outbound trunk** pointing at Twilio. Save as `outbound-trunk.json`:

   ```json
   {
     "trunk": {
       "name": "twilio-outbound",
       "address": "your-name.pstn.twilio.com",
       "numbers": ["+1YOURTWILIONUMBER"]
     }
   }
   ```

   ```bash
   lk sip outbound create outbound-trunk.json \
     --auth-user "YOUR_CREDENTIAL_LIST_USERNAME" \
     --auth-pass "YOUR_CREDENTIAL_LIST_PASSWORD"
   # prints: SIPTrunkID: ST_xxxx
   ```
4. Put both values in `backend/.env`:
   - `SIP_OUTBOUND_TRUNK_ID=ST_xxxx` (printed above)
   - `HUMAN_AGENT_PHONE_NUMBER=+1...` — the number to ring (E.164). This is **not** the Twilio
     number from step 1 — that's the caller ID. This is whoever should pick up.

If these are unset, `request_human` tells the caller no human is available (graceful no-op).

---

## 5. How the flows work

### Conversation & intent
`backend/tools.py` defines `Assistant`, an `Agent` whose system prompt makes Agent A collect booking
details and decide intent (book / reschedule / cancel / lookup / human). `agent.py` wires Deepgram
STT → Groq LLM → ElevenLabs TTS in an `AgentSession`. The detected intent is published live.

### Appointment booking (tool calls)
- `record_details` — saves any collected field as soon as it's known (drives the live "Collected
  details" panel).
- `check_availability(date, time?)` — reads open SQLite slots (`db.list_availability`).
- `book_appointment(...)` — atomically books a slot (`db.book_slot`), returns a confirmation code,
  and Agent A reads it back. Bonus: `lookup_appointment`, `cancel_appointment`.

### Live monitoring & take-over
`backend/monitoring.py` publishes:
- **participant attributes** — `state` (listening/thinking/speaking/paused/ended), `intent`,
  `action` ("checking availability…", "booking…", "transferring…"), `status`
  (connected→transferring→ended), and the collected `name`/`reason`/`datetime`/`phone`.
- **data packets** on topic `monitor` — transcript segments (interim + final), lifecycle events,
  and the final summary.

The dashboard (`frontend/app/monitor/page.tsx`) subscribes via `RoomEvent.ParticipantAttributesChanged`
and `RoomEvent.DataReceived` — no polling. **Take over** calls the agent's `takeover` RPC
(`session.interrupt()` + disables the agent's audio input) and unmutes the watcher's mic, so the
watcher talks directly to the caller. **Hand back** calls `resume`.

### Warm transfer (Twilio)
`backend/transfer.py`: Agent A generates a short spoken handoff summary, dials the human into a private
transfer room via `sip.create_sip_participant`, and a briefing agent reads the summary and asks if
they can take it.
- **Accept** → the human is moved into the caller's room (`room.move_participant`); Agent A says
  goodbye and leaves the two connected.
- **Decline / no answer** → Agent A returns to the caller: "the team isn't available right now."

### Post-call summary
When the caller hangs up (or after an accepted transfer), `agent.py` builds a transcript from
`session.history`, asks Groq for a summary (`summary.py`), saves it to `call_summaries`, and pushes
it to the dashboard.

---

## 6. Demo checklist

1. **Book**: caller asks to book → Agent A collects details → checks availability → confirms + reads back code.
2. **Monitor**: `/monitor` shows transcript, state, intent, action, status, and collected details updating live.
3. **Take over**: click **Take over** mid-call → agent pauses, you speak to the caller.
4. **Warm transfer**: caller says "talk to a person" → human's phone rings → summary is spoken →
   show both **accept** (connected) and **decline** (team unavailable).
5. **Summary**: end the call → post-call summary appears on the dashboard.

**Demo video**: TODO — add link here.

## Project structure

```
backend/   agent.py tools.py db.py monitoring.py summary.py transfer.py config.py seed.py
frontend/  app/page.tsx  app/monitor/page.tsx  app/api/token/route.ts  lib/livekit.ts  components/MonitorPanels.tsx
```
