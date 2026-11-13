import { PROTOCOL_VERSION } from "@contractplay/protocol";
import type { ClientMessage, RefusalReason, ServerMessage, TableScoring, TableStyle, TableSummary, TableView } from "@contractplay/protocol";
import { isNativeClient } from "../nativeFiles.js";
import type { Identity } from "./identity.js";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "reload" | "gone";
export type TableConnection = { send(message: Exclude<ClientMessage, { type: "hello" }>): void; close(): void };

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000];
const SOCKET_OPEN = 1;

/**
 * The online service origin: undefined when the build setting is "none" or the app runs in the native (Tauri) shell
 * (desktop and iOS builds do not offer online play yet), else the build-time setting, else the page origin when served over http(s).
 */
export function serviceUrl(): string | undefined {
  const configured = import.meta.env.VITE_ONLINE_URL;
  if (configured === "none") return undefined;
  if (isNativeClient()) return undefined;
  if (configured) return configured;
  return location.protocol === "http:" || location.protocol === "https:" ? location.origin : undefined;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isView = (v: unknown): v is TableView => isRecord(v) && typeof v.revision === "number";

function parseServerMessage(data: unknown): ServerMessage | undefined {
  if (typeof data !== "string") return undefined;
  let frame: unknown;
  try { frame = JSON.parse(data); } catch { return undefined; }
  if (!isRecord(frame)) return undefined;
  switch (frame.type) {
    case "view": return isView(frame.view) ? { type: "view", view: frame.view } : undefined;
    case "refused": return typeof frame.reason === "string" && isView(frame.view) ? { type: "refused", reason: frame.reason as RefusalReason, view: frame.view } : undefined;
    case "reload": return { type: "reload" };
    case "gone": return { type: "gone" };
    default: return undefined;
  }
}

export function connectTable(input: {
  baseUrl: string; tableId: string; identity: Identity;
  onView(view: TableView): void; onRefused(reason: RefusalReason): void; onStatus(status: ConnectionStatus): void;
  createSocket?: (url: string) => WebSocket;
}): TableConnection {
  const url = `${input.baseUrl.replace(/^http/, "ws").replace(/\/+$/, "")}/api/tables/${encodeURIComponent(input.tableId)}/ws`;
  const createSocket = input.createSocket ?? ((target: string) => new WebSocket(target));
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let stopped = false;

  const stop = (status?: ConnectionStatus) => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (status) input.onStatus(status);
  };

  function open() {
    timer = undefined;
    input.onStatus(attempt === 0 ? "connecting" : "reconnecting");
    const current = createSocket(url);
    socket = current;
    current.onopen = () => {
      if (stopped || socket !== current) return;
      attempt = 0;
      current.send(JSON.stringify({ type: "hello", version: PROTOCOL_VERSION, secret: input.identity.secret, name: input.identity.name } satisfies ClientMessage));
      input.onStatus("open");
    };
    current.onmessage = (event) => {
      if (stopped || socket !== current) return;
      const message = parseServerMessage(event.data);
      if (!message) return;
      if (message.type === "view") input.onView(message.view);
      else if (message.type === "refused") { input.onRefused(message.reason); input.onView(message.view); }
      else { stop(message.type); current.close(); }
    };
    current.onclose = () => {
      if (stopped || socket !== current) return;
      socket = undefined;
      const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 8000;
      attempt += 1;
      input.onStatus("reconnecting");
      timer = setTimeout(open, delay);
    };
  }

  open();

  return {
    send(message) {
      if (stopped || !socket || socket.readyState !== SOCKET_OPEN) return;
      socket.send(JSON.stringify(message));
    },
    close() {
      stop();
      const current = socket;
      socket = undefined;
      current?.close();
    }
  };
}

export async function listTables(baseUrl: string): Promise<TableSummary[]> {
  const response = await fetch(`${baseUrl}/api/tables`);
  if (!response.ok) throw new Error(`Listing tables failed (${response.status})`);
  return (await response.json()) as TableSummary[];
}

export async function createTable(baseUrl: string, input: { name: string; style: TableStyle; scoring: TableScoring; listed: boolean }): Promise<{ id: string } | { error: string }> {
  try {
    const response = await fetch(`${baseUrl}/api/tables`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input)
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok && isRecord(body) && typeof body.id === "string") return { id: body.id };
    if (response.status === 429 && isRecord(body) && typeof body.error === "string") return { error: body.error };
    return { error: response.status === 400 ? "bad-request" : "failed" };
  } catch {
    return { error: "network" };
  }
}
