"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useRoomContext,
} from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { DEFAULT_ROOM, fetchToken, randId } from "@/lib/livekit";

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
        <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8">
          <h1 className="text-2xl font-semibold">Northside Health Clinic</h1>
          <p className="mt-1 text-neutral-400">Call our voice receptionist to book an appointment.</p>

          <label className="mt-6 block text-sm text-neutral-400">Room</label>
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-neutral-500"
          />

          <button
            onClick={start}
            disabled={busy || !room}
            className="mt-6 w-full rounded-lg bg-emerald-600 px-4 py-3 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? "Connecting…" : "Start call"}
          </button>

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          <Link
            href={`/monitor?room=${encodeURIComponent(room)}`}
            className="mt-4 block text-center text-sm text-neutral-400 underline hover:text-neutral-200"
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

  const label: Record<string, string> = {
    [ConnectionState.Connecting]: "Connecting…",
    [ConnectionState.Connected]: "Connected — say hello",
    [ConnectionState.Reconnecting]: "Reconnecting…",
    [ConnectionState.Disconnected]: "Disconnected",
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-600/20">
          <span className="text-3xl">📞</span>
        </div>
        <h1 className="mt-4 text-xl font-semibold">On a call with Riley</h1>
        <p className="mt-1 text-sm text-neutral-400">Room: {room}</p>
        <p className="mt-4 inline-block rounded-full bg-neutral-800 px-3 py-1 text-sm text-neutral-200">
          {label[state] ?? state}
        </p>
        <p className="mt-4 text-sm text-neutral-500">
          Your mic is live. Ask to book, reschedule, or to speak to a person.
        </p>
        <button
          onClick={() => lkRoom.disconnect()}
          className="mt-6 w-full rounded-lg bg-red-600 px-4 py-3 font-medium text-white hover:bg-red-500"
        >
          End call
        </button>
      </div>
    </main>
  );
}
