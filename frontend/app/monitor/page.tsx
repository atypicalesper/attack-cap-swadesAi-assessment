"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ConnectionState,
  RemoteParticipant,
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
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
import {
  AgentStatePanel,
  CollectedData,
  EventEntry,
  EventsLog,
  StatusBadge,
  SummaryCard,
  TranscriptEntry,
  TranscriptPanel,
} from "@/components/MonitorPanels";

type Phase = "form" | "connecting" | "live";

export default function MonitorPage() {
  const [roomName, setRoomName] = useState(DEFAULT_ROOM);
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState("");

  const [attrs, setAttrs] = useState<AgentAttributes>(EMPTY_ATTRS);
  const [finals, setFinals] = useState<TranscriptEntry[]>([]);
  const [interim, setInterim] = useState("");
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [summary, setSummary] = useState<{ text: string; outcome: string } | null>(null);
  const [connState, setConnState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [takenOver, setTakenOver] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const agentIdRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("room");
    if (q) setRoomName(q);
  }, []);

  const adoptAgent = useCallback((p: RemoteParticipant) => {
    if (isAgent(p.attributes)) {
      agentIdRef.current = p.identity;
      setAttrs(readAgentAttributes(p.attributes));
    }
  }, []);

  const connect = useCallback(async () => {
    setError("");
    setPhase("connecting");
    setFinals([]);
    setEvents([]);
    setSummary(null);
    setInterim("");

    const room = new Room({ adaptiveStream: true });
    roomRef.current = room;

    room.on(RoomEvent.ConnectionStateChanged, (s) => setConnState(s));

    room.on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) => {
      if (participant instanceof RemoteParticipant) adoptAgent(participant);
    });
    room.on(RoomEvent.ParticipantConnected, (p) => adoptAgent(p));

    room.on(RoomEvent.DataReceived, (payload, _p, _kind, topic) => {
      if (topic !== "monitor") return;
      const msg = decodeMonitor(payload);
      if (!msg) return;
      if (msg.type === "transcript") {
        if (msg.final) {
          setFinals((prev) => [
            ...prev,
            { id: `${msg.ts}-${randId()}`, role: msg.role, text: msg.text, final: true, ts: msg.ts },
          ]);
          if (msg.role === "caller") setInterim("");
        } else if (msg.role === "caller") {
          setInterim(msg.text);
        }
      } else if (msg.type === "event") {
        setEvents((prev) => [...prev, { name: msg.name, detail: msg.detail, ts: msg.ts }]);
      } else if (msg.type === "summary") {
        setSummary({ text: msg.text, outcome: msg.outcome });
      }
    });

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach();
        audioRef.current?.appendChild(el);
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      track.detach().forEach((el) => el.remove());
    });

    try {
      const data = await fetchToken(roomName, `watcher-${randId()}`, "Watcher");
      await room.connect(data.url, data.token);
      await room.startAudio().catch(() => {});
      room.remoteParticipants.forEach((p) => adoptAgent(p));
      setPhase("live");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect");
      setPhase("form");
      roomRef.current = null;
    }
  }, [roomName, adoptAgent]);

  const disconnect = useCallback(async () => {
    await roomRef.current?.disconnect();
    roomRef.current = null;
    agentIdRef.current = null;
    setPhase("form");
    setConnState(ConnectionState.Disconnected);
    setTakenOver(false);
  }, []);

  useEffect(() => () => void roomRef.current?.disconnect(), []);

  const takeover = useCallback(async () => {
    const room = roomRef.current;
    const agentId = agentIdRef.current;
    if (!room || !agentId) return;
    try {
      await room.localParticipant.performRpc({ destinationIdentity: agentId, method: "takeover", payload: "" });
      await room.localParticipant.setMicrophoneEnabled(true);
      setTakenOver(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Take-over failed");
    }
  }, []);

  const handBack = useCallback(async () => {
    const room = roomRef.current;
    const agentId = agentIdRef.current;
    if (!room || !agentId) return;
    try {
      await room.localParticipant.performRpc({ destinationIdentity: agentId, method: "resume", payload: "" });
      await room.localParticipant.setMicrophoneEnabled(false);
      setTakenOver(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Hand-back failed");
    }
  }, []);

  const transcriptEntries: TranscriptEntry[] = interim
    ? [...finals, { id: "interim", role: "caller", text: interim, final: false, ts: Date.now() }]
    : finals;

  if (phase !== "live") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8">
          <h1 className="text-2xl font-semibold">Live monitoring</h1>
          <p className="mt-1 text-neutral-400">Watch an ongoing call and take over if needed.</p>

          <label className="mt-6 block text-sm text-neutral-400">Room to monitor</label>
          <input
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-neutral-500"
          />

          <button
            onClick={connect}
            disabled={phase === "connecting" || !roomName}
            className="mt-6 w-full rounded-lg bg-sky-600 px-4 py-3 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {phase === "connecting" ? "Connecting…" : "Monitor call"}
          </button>
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          <Link href="/" className="mt-4 block text-center text-sm text-neutral-400 underline hover:text-neutral-200">
            ← Back to caller
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 lg:p-6">
      <div ref={audioRef} className="hidden" />
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Monitoring · {roomName}</h1>
          <StatusBadge status={attrs.status} />
          {takenOver && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300">
              You are in control
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!takenOver ? (
            <button
              onClick={takeover}
              disabled={!agentIdRef.current || attrs.status === "ended"}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40"
            >
              Take over
            </button>
          ) : (
            <button
              onClick={handBack}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Hand back to agent
            </button>
          )}
          <button
            onClick={disconnect}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            Leave
          </button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="h-[70vh]">
          <TranscriptPanel entries={transcriptEntries} />
        </div>
        <div className="space-y-4">
          <AgentStatePanel attrs={attrs} />
          <CollectedData attrs={attrs} />
          <EventsLog events={events} />
          {summary && <SummaryCard text={summary.text} outcome={summary.outcome} />}
        </div>
      </div>

      {connState !== ConnectionState.Connected && (
        <p className="mt-3 text-sm text-neutral-500">Connection: {connState}</p>
      )}
    </main>
  );
}
