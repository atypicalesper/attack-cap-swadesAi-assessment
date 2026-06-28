"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useRoomContext,
} from "@livekit/components-react";
import { ConnectionState, LocalParticipant, RemoteParticipant, RoomEvent } from "livekit-client";
import {
  AgentAttributes,
  DEFAULT_ROOM,
  EMPTY_ATTRS,
  decodeMonitor,
  fetchToken,
  isAgent,
  randId,
  readAgentAttributes,
} from "@/lib/livekit";
import { STATE_LABEL, STATE_STYLE, TranscriptEntry, TranscriptPanel, VoiceWave } from "@/components/MonitorPanels";

export default function CallerPage() {
  const [room, setRoom] = useState(DEFAULT_ROOM);
  const [conn, setConn] = useState<{ token: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const start = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const data = await fetchToken(room, `caller-${randId()}`, "Caller");
      setConn({ token: data.token, url: data.url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  }, [room]);

  if (!conn) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-violet-100 bg-white/90 p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-800">Northside Health Clinic</h1>
          <p className="mt-1 text-slate-500">Call our voice receptionist to book an appointment.</p>

          <label className="mt-6 block text-sm text-slate-500">Room</label>
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-slate-700 outline-none focus:border-violet-400"
          />

          <button
            onClick={start}
            disabled={busy || !room}
            className="mt-6 w-full rounded-lg bg-violet-200 px-4 py-3 font-medium text-violet-900 hover:bg-violet-300 disabled:opacity-50"
          >
            {busy ? "Connecting…" : "Start call"}
          </button>

          {error && <p className="mt-3 text-sm text-rose-500">{error}</p>}

          <Link
            href={`/monitor?room=${encodeURIComponent(room)}`}
            className="mt-4 block text-center text-sm text-slate-400 underline hover:text-slate-600"
          >
            Open monitoring dashboard →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <LiveKitRoom
      token={conn.token}
      serverUrl={conn.url}
      connect
      audio
      video={false}
      onDisconnected={() => setConn(null)}
    >
      <RoomAudioRenderer />
      <CallActive room={room} />
    </LiveKitRoom>
  );
}

function CallActive({ room }: { room: string }) {
  const state = useConnectionState();
  const lkRoom = useRoomContext();
  const [attrs, setAttrs] = useState<AgentAttributes>(EMPTY_ATTRS);
  const [finals, setFinals] = useState<TranscriptEntry[]>([]);
  const [interim, setInterim] = useState("");
  const [muted, setMuted] = useState(false);

  const label: Record<string, string> = {
    [ConnectionState.Connecting]: "Connecting…",
    [ConnectionState.Connected]: "Connected",
    [ConnectionState.Reconnecting]: "Reconnecting…",
    [ConnectionState.Disconnected]: "Disconnected",
  };

  useEffect(() => {
    const adopt = (p: RemoteParticipant) => {
      if (isAgent(p.attributes)) setAttrs(readAgentAttributes(p.attributes));
    };
    lkRoom.remoteParticipants.forEach(adopt);

    const onAttrs = (_changed: Record<string, string>, participant: RemoteParticipant | LocalParticipant) => {
      if (participant instanceof RemoteParticipant) adopt(participant);
    };
    const onJoin = (p: RemoteParticipant) => adopt(p);
    const onData = (payload: Uint8Array, _p?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== "monitor") return;
      const msg = decodeMonitor(payload);
      if (!msg || msg.type !== "transcript") return;
      if (msg.final) {
        setFinals((prev) => [
          ...prev,
          { id: `${msg.ts}-${randId()}`, role: msg.role, text: msg.text, final: true, ts: msg.ts },
        ]);
        if (msg.role === "caller") setInterim("");
      } else if (msg.role === "caller") {
        setInterim(msg.text);
      }
    };
    lkRoom.on(RoomEvent.ParticipantAttributesChanged, onAttrs);
    lkRoom.on(RoomEvent.ParticipantConnected, onJoin);
    lkRoom.on(RoomEvent.DataReceived, onData);
    return () => {
      lkRoom.off(RoomEvent.ParticipantAttributesChanged, onAttrs);
      lkRoom.off(RoomEvent.ParticipantConnected, onJoin);
      lkRoom.off(RoomEvent.DataReceived, onData);
    };
  }, [lkRoom]);

  const dotStyle = STATE_STYLE[attrs.state] ?? "text-slate-400";
  const active = attrs.state === "listening" || attrs.state === "thinking" || attrs.state === "speaking";
  const beingTakenOver = attrs.state === "paused";

  const toggleMute = useCallback(async () => {
    const next = !muted;
    await lkRoom.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }, [lkRoom, muted]);

  const transcriptEntries: TranscriptEntry[] = interim
    ? [...finals, { id: "interim", role: "caller", text: interim, final: false, ts: Date.now() }]
    : finals;

  return (
    <main className="min-h-screen flex items-center justify-center gap-4 p-6 lg:items-start lg:justify-center lg:pt-12">
      <div className="w-full max-w-md rounded-2xl border border-violet-100 bg-white/90 p-8 text-center shadow-sm">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-violet-100">
          <span className="text-3xl">📞</span>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-slate-800">On a call with Agent A</h1>
        <p className="mt-1 text-sm text-slate-500">Room: {room}</p>
        <p className="mt-4 inline-block rounded-full bg-violet-50 px-3 py-1 text-sm text-violet-700">
          {label[state] ?? state}
        </p>

        {state === ConnectionState.Connected && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <VoiceWave state={attrs.state} />
            <div className="flex items-center justify-center gap-2 text-sm">
              <span className={`${dotStyle} ${active ? "pulse-dot" : ""}`}>●</span>
              <span className="font-medium text-slate-700">{STATE_LABEL[attrs.state] ?? "Connecting…"}</span>
            </div>
          </div>
        )}

        {beingTakenOver ? (
          <p className="mt-4 text-sm text-amber-600">You're now speaking with a member of our team.</p>
        ) : (
          <p className="mt-4 text-sm text-slate-400">
            Your mic is live. Ask to book, reschedule, or to speak to a person.
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={toggleMute}
            className={`flex-1 rounded-lg px-4 py-3 font-medium ${
              muted ? "bg-amber-200 text-amber-900 hover:bg-amber-300" : "bg-violet-100 text-violet-800 hover:bg-violet-200"
            }`}
          >
            {muted ? "Unmute" : "Mute"}
          </button>
          <button
            onClick={() => lkRoom.disconnect()}
            className="flex-1 rounded-lg bg-rose-200 px-4 py-3 font-medium text-rose-900 hover:bg-rose-300"
          >
            End call
          </button>
        </div>
      </div>

      <div className="hidden h-[70vh] w-full max-w-sm lg:block">
        <TranscriptPanel entries={transcriptEntries} />
      </div>
    </main>
  );
}
