// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TableView } from "@contractplay/protocol";
import { PROTOCOL_VERSION } from "@contractplay/protocol";
import { connectTable, createTable, listTables, serviceUrl, type ConnectionStatus } from "./connection.js";

class FakeSocket {
  static readonly OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(data: unknown) { this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) }); }
  drop() { this.readyState = 3; this.onclose?.(); }
}

const view = (revision: number) => ({ id: "ABC234", name: "T", revision }) as unknown as TableView;
const identity = { secret: "s".repeat(43), name: "Ann" };

function setup() {
  const sockets: FakeSocket[] = [];
  const views: TableView[] = [];
  const refusals: string[] = [];
  const statuses: ConnectionStatus[] = [];
  const connection = connectTable({
    baseUrl: "https://example.com", tableId: "ABC234", identity,
    onView: (v) => views.push(v), onRefused: (r) => refusals.push(r), onStatus: (s) => statuses.push(s),
    createSocket: (url) => { const s = new FakeSocket(url); sockets.push(s); return s as unknown as WebSocket; }
  });
  return { sockets, views, refusals, statuses, connection };
}

describe("connectTable", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("derives the websocket URL and sends hello first", () => {
    const { sockets, statuses } = setup();
    expect(sockets[0]?.url).toBe("wss://example.com/api/tables/ABC234/ws");
    expect(statuses).toEqual(["connecting"]);
    sockets[0]?.open();
    expect(JSON.parse(sockets[0]?.sent[0] ?? "")).toEqual({ type: "hello", version: PROTOCOL_VERSION, secret: identity.secret, name: "Ann" });
    expect(statuses).toEqual(["connecting", "open"]);
  });

  it("uses ws for http base URLs", () => {
    const sockets: FakeSocket[] = [];
    connectTable({
      baseUrl: "http://localhost:8787", tableId: "X", identity, onView() {}, onRefused() {}, onStatus() {},
      createSocket: (url) => { const s = new FakeSocket(url); sockets.push(s); return s as unknown as WebSocket; }
    });
    expect(sockets[0]?.url).toBe("ws://localhost:8787/api/tables/X/ws");
  });

  it("passes every view through, including repeated revisions", () => {
    const { sockets, views } = setup();
    sockets[0]?.open();
    sockets[0]?.receive({ type: "view", view: view(3) });
    sockets[0]?.receive({ type: "view", view: view(3) });
    expect(views.map((v) => v.revision)).toEqual([3, 3]);
  });

  it("reports a refusal then its view", () => {
    const { sockets, views, refusals } = setup();
    sockets[0]?.open();
    sockets[0]?.receive({ type: "refused", reason: "stale", view: view(4) });
    expect(refusals).toEqual(["stale"]);
    expect(views).toHaveLength(1);
  });

  it("ignores malformed frames without throwing", () => {
    const { sockets, views, refusals } = setup();
    sockets[0]?.open();
    for (const frame of ["not json", "null", "[]", JSON.stringify({ type: "view" }), JSON.stringify({ type: "refused", reason: "stale" }), JSON.stringify({ type: "wat" }), new ArrayBuffer(2)]) {
      expect(() => sockets[0]?.receive(frame)).not.toThrow();
    }
    expect(views).toHaveLength(0);
    expect(refusals).toHaveLength(0);
  });

  it("reconnects with backoff 1, 2, 4, 8, 8 seconds", () => {
    const { sockets, statuses } = setup();
    sockets[0]?.open();
    sockets[0]?.drop();
    expect(statuses.at(-1)).toBe("reconnecting");
    expect(sockets).toHaveLength(1);
    for (const [i, delay] of [1000, 2000, 4000, 8000, 8000].entries()) {
      vi.advanceTimersByTime(delay - 1);
      expect(sockets).toHaveLength(i + 1);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(i + 2);
      sockets[i + 1]?.drop();
    }
  });

  it("resets the backoff after a successful open", () => {
    const { sockets } = setup();
    sockets[0]?.drop();
    vi.advanceTimersByTime(1000);
    sockets[1]?.drop();
    vi.advanceTimersByTime(2000);
    sockets[2]?.open();
    sockets[2]?.drop();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(4);
  });

  it("stops permanently on gone", () => {
    const { sockets, statuses } = setup();
    sockets[0]?.open();
    sockets[0]?.receive({ type: "gone" });
    expect(statuses.at(-1)).toBe("gone");
    sockets[0]?.drop();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(statuses.at(-1)).toBe("gone");
  });

  it("stops permanently on reload", () => {
    const { sockets, statuses } = setup();
    sockets[0]?.open();
    sockets[0]?.receive({ type: "reload" });
    sockets[0]?.drop();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(statuses.at(-1)).toBe("reload");
  });

  it("drops sends while not open and sends while open", () => {
    const { sockets, connection } = setup();
    connection.send({ type: "deal" });
    sockets[0]?.open();
    connection.send({ type: "deal" });
    expect(sockets[0]?.sent.map((s) => JSON.parse(s).type)).toEqual(["hello", "deal"]);
    sockets[0]?.drop();
    connection.send({ type: "leave" });
    vi.advanceTimersByTime(1000);
    sockets[1]?.open();
    expect(sockets[1]?.sent.map((s) => JSON.parse(s).type)).toEqual(["hello"]);
  });

  it("close clears the pending reconnect and never reconnects", () => {
    const { sockets, connection, statuses } = setup();
    sockets[0]?.open();
    sockets[0]?.drop();
    connection.close();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(statuses.at(-1)).toBe("reconnecting");
  });

  it("close on an open socket closes it and ignores its later events", () => {
    const { sockets, connection, views, statuses } = setup();
    sockets[0]?.open();
    connection.close();
    expect(sockets[0]?.closed).toBe(true);
    const before = statuses.length;
    sockets[0]?.receive({ type: "view", view: view(1) });
    sockets[0]?.drop();
    vi.advanceTimersByTime(60_000);
    expect(views).toHaveLength(0);
    expect(statuses).toHaveLength(before);
    expect(sockets).toHaveLength(1);
  });
});

describe("serviceUrl", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("prefers VITE_ONLINE_URL", () => {
    vi.stubEnv("VITE_ONLINE_URL", "https://play.example.org");
    expect(serviceUrl()).toBe("https://play.example.org");
  });

  it("is undefined when VITE_ONLINE_URL is none, even on an http(s) page", () => {
    vi.stubEnv("VITE_ONLINE_URL", "none");
    expect(serviceUrl()).toBeUndefined();
  });

  it("falls back to the page origin on http(s)", () => {
    vi.stubEnv("VITE_ONLINE_URL", "");
    expect(serviceUrl()).toBe(location.origin);
  });

  it("is undefined when the page is not served over http(s)", () => {
    vi.stubEnv("VITE_ONLINE_URL", "");
    vi.stubGlobal("location", { protocol: "tauri:", origin: "tauri://localhost" });
    expect(serviceUrl()).toBeUndefined();
  });

  it("is undefined in the native shell even though it serves the page over http", () => {
    vi.stubEnv("VITE_ONLINE_URL", "");
    vi.stubGlobal("isTauri", true);
    vi.stubGlobal("location", { protocol: "http:", origin: "http://tauri.localhost" });
    expect(serviceUrl()).toBeUndefined();
  });

  it("is undefined in the native shell even with a configured URL", () => {
    vi.stubEnv("VITE_ONLINE_URL", "https://play.example.org");
    vi.stubGlobal("isTauri", true);
    expect(serviceUrl()).toBeUndefined();
  });
});

describe("HTTP helpers", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("lists tables", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: "A" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(listTables("https://x.test")).resolves.toEqual([{ id: "A" }]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://x.test/api/tables");
  });

  it("rejects when listing fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 500 })));
    await expect(listTables("https://x.test")).rejects.toThrow();
  });

  it("creates a table", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "ABC234" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createTable("https://x.test", { name: "T", style: "SAYC", listed: true })).resolves.toEqual({ id: "ABC234" });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "T", style: "SAYC", listed: true });
  });

  it("returns the error code on 429 and a generic error otherwise", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "too-many-tables" }), { status: 429 })));
    await expect(createTable("https://x.test", { name: "T", style: "2/1", listed: false })).resolves.toEqual({ error: "too-many-tables" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 400 })));
    await expect(createTable("https://x.test", { name: "", style: "2/1", listed: false })).resolves.toEqual({ error: "bad-request" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(createTable("https://x.test", { name: "T", style: "2/1", listed: false })).resolves.toEqual({ error: "network" });
  });
});
