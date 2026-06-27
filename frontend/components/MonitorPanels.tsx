"use client";

import { useEffect, useRef } from "react";
import type { AgentAttributes } from "@/lib/livekit";

export interface TranscriptEntry {
  id: string;
  role: "caller" | "agent";
  text: string;
  final: boolean;
  ts: number;
}

export interface EventEntry {
  name: string;
  detail: string;
  ts: number;
}

const STATUS_STYLE: Record<string, string> = {
  connected: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  transferring: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  ended: "bg-neutral-600/20 text-neutral-300 border-neutral-600/40",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? "bg-neutral-700/30 text-neutral-300 border-neutral-600/40";
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide ${style}`}>
      {status || "—"}
    </span>
  );
}

const STATE_STYLE: Record<string, string> = {
  listening: "text-sky-300",
  thinking: "text-violet-300",
  speaking: "text-emerald-300",
  paused: "text-amber-300",
  ended: "text-neutral-400",
  connecting: "text-neutral-400",
};

export function AgentStatePanel({ attrs }: { attrs: AgentAttributes }) {
  const dot = STATE_STYLE[attrs.state] ?? "text-neutral-400";
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Agent state</h2>
      <div className="mt-2 flex items-center gap-2">
        <span className={`text-lg ${dot}`}>●</span>
        <span className="text-lg font-semibold capitalize">{attrs.state || "—"}</span>
      </div>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-neutral-500">Intent</dt>
          <dd className="font-medium capitalize">{attrs.intent || "—"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-neutral-500">Action</dt>
          <dd className="font-medium text-amber-300">{attrs.action || "—"}</dd>
        </div>
      </dl>
    </div>
  );
}

export function CollectedData({ attrs }: { attrs: AgentAttributes }) {
  const rows: [string, string][] = [
    ["Name", attrs.name],
    ["Reason", attrs.reason],
    ["Date / time", attrs.datetime],
    ["Phone", attrs.phone],
  ];
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Collected details</h2>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-neutral-500">{k}</dt>
            <dd className={`text-right font-medium ${v ? "text-neutral-100" : "text-neutral-600"}`}>
              {v || "—"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function TranscriptPanel({ entries }: { entries: TranscriptEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [entries]);

  return (
    <div className="flex h-full flex-col rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Live transcript</h2>
      <div ref={ref} className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
        {entries.length === 0 && <p className="text-sm text-neutral-600">Waiting for conversation…</p>}
        {entries.map((e) => (
          <div key={e.id} className={e.role === "agent" ? "text-left" : "text-right"}>
            <div
              className={`inline-block max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                e.role === "agent"
                  ? "bg-neutral-800 text-neutral-100"
                  : "bg-sky-600/20 text-sky-100"
              } ${e.final ? "" : "opacity-60 italic"}`}
            >
              <span className="mr-2 text-[10px] uppercase tracking-wide text-neutral-500">
                {e.role}
              </span>
              {e.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EventsLog({ events }: { events: EventEntry[] }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Events</h2>
      <ul className="mt-3 space-y-1 text-xs">
        {events.length === 0 && <li className="text-neutral-600">No events yet.</li>}
        {events
          .slice()
          .reverse()
          .map((e, i) => (
            <li key={i} className="flex justify-between gap-2 border-b border-neutral-800/60 pb-1">
              <span className="font-medium text-neutral-300">{e.name}</span>
              <span className="truncate text-right text-neutral-500">{e.detail}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

export function SummaryCard({ text, outcome }: { text: string; outcome: string }) {
  return (
    <div className="rounded-xl border border-emerald-700/40 bg-emerald-900/10 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
          Post-call summary
        </h2>
        {outcome && (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase text-emerald-300">
            {outcome}
          </span>
        )}
      </div>
      <div className="mt-2 whitespace-pre-wrap text-sm text-neutral-200">{text}</div>
    </div>
  );
}
