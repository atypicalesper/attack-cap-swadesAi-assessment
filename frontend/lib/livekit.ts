export const DEFAULT_ROOM = "clinic-demo";

export interface AgentAttributes {
  state: string; // connecting | listening | thinking | speaking | paused | ended
  intent: string; // book | reschedule | cancel | lookup | human | ""
  action: string; // "checking availability...", "booking...", "transferring...", ""
  status: string; // connected | transferring | ended
  name: string;
  reason: string;
  datetime: string;
  phone: string;
}

export const EMPTY_ATTRS: AgentAttributes = {
  state: "connecting",
  intent: "",
  action: "",
  status: "connected",
  name: "",
  reason: "",
  datetime: "",
  phone: "",
};

export type MonitorMessage =
  | { type: "transcript"; role: "caller" | "agent"; text: string; final: boolean; ts: number }
  | { type: "event"; name: string; detail: string; ts: number }
  | { type: "summary"; text: string; outcome: string; ts: number };

export function decodeMonitor(payload: Uint8Array): MonitorMessage | null {
  try {
    return JSON.parse(new TextDecoder().decode(payload)) as MonitorMessage;
  } catch {
    return null;
  }
}

/** The agent is the only participant that publishes our state attributes. */
export function readAgentAttributes(attributes: Record<string, string>): AgentAttributes {
  return {
    state: attributes.state ?? "",
    intent: attributes.intent ?? "",
    action: attributes.action ?? "",
    status: attributes.status ?? "",
    name: attributes.name ?? "",
    reason: attributes.reason ?? "",
    datetime: attributes.datetime ?? "",
    phone: attributes.phone ?? "",
  };
}

export function isAgent(attributes: Record<string, string>): boolean {
  return attributes != null && typeof attributes.state === "string" && attributes.state.length > 0;
}

export async function fetchToken(room: string, identity: string, name: string) {
  const res = await fetch(
    `/api/token?room=${encodeURIComponent(room)}&identity=${encodeURIComponent(
      identity,
    )}&name=${encodeURIComponent(name)}`,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Token request failed (${res.status})`);
  }
  return (await res.json()) as { token: string; url: string; room: string; identity: string };
}

export function randId() {
  return Math.random().toString(36).slice(2, 8);
}
