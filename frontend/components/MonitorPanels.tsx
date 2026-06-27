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
  connected: "bg-emerald-100 text-emerald-700 border-emerald-200",
  transferring: "bg-amber-100 text-amber-700 border-amber-200",
  ended: "bg-slate-100 text-slate-500 border-slate-200",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? "bg-violet-100 text-violet-700 border-violet-200";
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide ${style}`}>
      {status || "—"}
    </span>
  );
}

export const STATE_STYLE: Record<string, string> = {
  listening: "text-sky-500",
  thinking: "text-violet-500",
  speaking: "text-emerald-500",
  paused: "text-amber-500",
  ended: "text-slate-400",
  connecting: "text-slate-400",
};

export const STATE_LABEL: Record<string, string> = {
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  paused: "Paused — watcher in control",
  ended: "Call ended",
  connecting: "Connecting",
};

export function AgentStatePanel({ attrs }: { attrs: AgentAttributes }) {
  const dot = STATE_STYLE[attrs.state] ?? "text-slate-400";
  const active = attrs.state === "listening" || attrs.state === "thinking" || attrs.state === "speaking";
  return (
    <div className="rounded-xl border border-violet-100 bg-white/90 p-4 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Agent state</h2>
      <div className="mt-2 flex items-center gap-2">
        <span className={`text-lg ${dot} ${active ? "pulse-dot" : ""}`}>●</span>
        <span className="text-lg font-semibold capitalize text-slate-700">{attrs.state || "—"}</span>
      </div>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-400">Intent</dt>
          <dd className="font-medium capitalize text-slate-700">{attrs.intent || "—"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-400">Action</dt>
          <dd className="font-medium text-amber-600">{attrs.action || "—"}</dd>
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
    <div className="rounded-xl border border-violet-100 bg-white/90 p-4 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Collected details</h2>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-slate-400">{k}</dt>
            <dd className={`text-right font-medium ${v ? "text-slate-700" : "text-slate-300"}`}>
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
    <div className="flex h-full flex-col rounded-xl border border-violet-100 bg-white/90 p-4 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Live transcript</h2>
      <div ref={ref} className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
        {entries.length === 0 && <p className="text-sm text-slate-300">Waiting for conversation…</p>}
        {entries.map((e) => (
          <div key={e.id} className={e.role === "agent" ? "text-left" : "text-right"}>
            <div
              className={`inline-block max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                e.role === "agent"
                  ? "bg-slate-100 text-slate-700"
                  : "bg-sky-100 text-sky-700"
              } ${e.final ? "" : "opacity-60 italic"}`}
            >
              <span className="mr-2 text-[10px] uppercase tracking-wide text-slate-400">
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
    <div className="rounded-xl border border-violet-100 bg-white/90 p-4 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Events</h2>
      <ul className="mt-3 space-y-1 text-xs">
        {events.length === 0 && <li className="text-slate-300">No events yet.</li>}
        {events
          .slice()
          .reverse()
          .map((e, i) => (
            <li key={i} className="flex justify-between gap-2 border-b border-slate-100 pb-1">
              <span className="font-medium text-slate-600">{e.name}</span>
              <span className="truncate text-right text-slate-400">{e.detail}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

export function SummaryCard({ text, outcome }: { text: string; outcome: string }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
          Post-call summary
        </h2>
        {outcome && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] uppercase text-emerald-700">
            {outcome}
          </span>
        )}
      </div>
      <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{text}</div>
    </div>
  );
}
