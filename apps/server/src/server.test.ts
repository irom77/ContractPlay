import { env } from "cloudflare:workers";
import { SELF, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { SEATS, playContextFor } from "@contractplay/core";
import type { GameAction, GameState, Seat } from "@contractplay/core";
import { createBot } from "@contractplay/bots";
import type { ClientMessage, ServerMessage, TableSummary, TableView } from "@contractplay/protocol";
import { BOT_PAUSE_MS, EMPTY_TABLE_MS, TRICK_PAUSE_MS } from "@contractplay/table";
import type { TableState } from "@contractplay/table";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { LobbyObject } from "./lobby-object.js";

const SECRET_A = "a".repeat(40);
const SECRET_B = "b".repeat(40);
const LISTED_ID = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const UNLISTED_ID = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/;

let ipCounter = 0;
/** A fresh client IP, so per-IP limits do not couple unrelated tests. */
const freshIp = () => { ipCounter += 1; return `10.${ipCounter >> 8}.${ipCounter & 255}.1`; };

async function createTable(body: unknown, ip = freshIp()): Promise<Response> {
  return SELF.fetch("https://x/api/tables", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "CF-Connecting-IP": ip } });
}

const upgrade = (id: string, ip?: string) =>
  SELF.fetch(`https://x/api/tables/${id}/ws`, { headers: { Upgrade: "websocket", ...(ip ? { "CF-Connecting-IP": ip } : {}) } });

async function newTableId(listed = true, name = "Test table"): Promise<string> {
  const response = await createTable({ name, style: "SAYC", listed });
  expect(response.status).toBe(201);
  const { id } = await response.json<{ id: string }>();
  expect(id).toMatch(listed ? LISTED_ID : UNLISTED_ID);
  return id;
}

async function listTables(): Promise<TableSummary[]> {
  const response = await SELF.fetch("https://x/api/tables");
  expect(response.status).toBe(200);
  return response.json<TableSummary[]>();
}

const stubFor = (id: string) => env.TABLES.get(env.TABLES.idFromName(id));

/** Fakes Date for this test only; the Worker shares the test's isolate, so the table sees the same clock. */
function fakeClock(): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  onTestFinished(() => { vi.useRealTimers(); });
}

/** Waits until the table holds exactly `count` sockets. */
async function socketsSettle(id: string, count: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await runInDurableObject(stubFor(id), (_instance, state) => state.getWebSockets().length) === count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("sockets did not settle");
}

/** Reads the table's stored state. */
const storedState = (id: string) => runInDurableObject(stubFor(id), (_instance, state) => state.storage.get<TableState>("state"));

/**
 * Moves the clock (Date is faked; the Worker shares the test's isolate) past any bot pause, then
 * runs the table's alarm, as the runtime would once the pause is over.
 */
async function runAlarmWhenDue(id: string): Promise<boolean> {
  vi.setSystemTime(Date.now() + BOT_PAUSE_MS + TRICK_PAUSE_MS);
  return runDurableObjectAlarm(stubFor(id));
}

/** Evicts the table's object; touching it first makes sure an instance is running to evict. */
async function evict(id: string, webSockets: "hibernate" | "close"): Promise<void> {
  const stub = stubFor(id);
  await runInDurableObject(stub, () => undefined);
  await evictDurableObject(stub, { webSockets });
}

/** A test-side WebSocket client that queues every server message. */
class Client {
  readonly received: ServerMessage[] = [];
  private queue: ServerMessage[] = [];
  private wake: (() => void) | undefined;
  closed = false;

  private constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      this.received.push(message);
      this.queue.push(message);
      this.wake?.();
    });
    ws.addEventListener("close", () => { this.closed = true; this.wake?.(); });
  }

  static async open(id: string, ip?: string): Promise<Client> {
    const response = await upgrade(id, ip);
    expect(response.status).toBe(101);
    const ws = response.webSocket!;
    ws.accept();
    return new Client(ws);
  }

  static async join(id: string, secret: string, name: string, ip?: string): Promise<{ client: Client; view: TableView }> {
    const client = await Client.open(id, ip);
    client.send({ type: "hello", version: 1, secret, name });
    const first = await client.next();
    if (first.type !== "view") throw new Error(`expected a view, got ${first.type}`);
    return { client, view: first.view };
  }

  send(message: ClientMessage | Record<string, unknown>): void { this.ws.send(JSON.stringify(message)); }

  private async waitForActivity(timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for the server")), timeoutMs);
      this.wake = () => { clearTimeout(timer); this.wake = undefined; resolve(); };
    });
  }

  /** The next server message. */
  async next(timeoutMs = 5000): Promise<ServerMessage> {
    while (this.queue.length === 0) {
      if (this.closed) throw new Error("socket closed");
      await this.waitForActivity(timeoutMs);
    }
    return this.queue.shift()!;
  }

  /** The newest view with a revision above `revision`, waiting for one if needed. Fails on a refusal. */
  async viewAfter(revision: number, timeoutMs = 5000): Promise<TableView> {
    for (;;) {
      let newest: TableView | undefined;
      for (const message of this.queue.splice(0)) {
        if (message.type === "refused") throw new Error(`refused: ${message.reason}`);
        if (message.type === "view" && message.view.revision > revision) newest = message.view;
      }
      if (newest) return newest;
      if (this.closed) throw new Error("socket closed");
      await this.waitForActivity(timeoutMs);
    }
  }

  async waitClosed(timeoutMs = 5000): Promise<void> {
    while (!this.closed) await this.waitForActivity(timeoutMs);
  }

  /** The newest view matching `predicate`, waiting for one if needed. */
  async until(predicate: (view: TableView) => boolean, timeoutMs = 5000): Promise<TableView> {
    for (;;) {
      const match = this.queue.splice(0).flatMap((m) => (m.type === "view" && predicate(m.view) ? [m.view] : [])).pop();
      if (match) return match;
      if (this.closed) throw new Error("socket closed");
      await this.waitForActivity(timeoutMs);
    }
  }

  /** Closes from this side; workerd does not report the close event to the side that closed. */
  close(): void {
    this.ws.close(1000, "bye");
    this.closed = true;
  }
}

const dummyOf = (declarer: Seat): Seat => SEATS[(SEATS.indexOf(declarer) + 2) % 4]!;

/** Whether the viewer decides the current turn, including a human dummy controlling a bot declarer. */
function viewerActs(view: TableView): boolean {
  const game = view.game;
  if (!game || (game.phase !== "auction" && game.phase !== "play") || !view.yourSeat) return false;
  const declarer = game.contract?.declarer;
  const dummy = declarer ? dummyOf(declarer) : undefined;
  const dummyInfo = dummy ? view.seats[dummy] : undefined;
  const humanDummyControls = game.phase === "play" && declarer !== undefined && dummyInfo?.kind === "human" &&
    view.seats[declarer].kind === "bot" && (dummyInfo.standIn !== undefined || !dummyInfo.away);
  const decider = humanDummyControls && (game.currentActor === declarer || game.currentActor === dummy)
    ? dummy!
    : game.phase === "play" && game.contract && game.currentActor === dummy
      ? game.contract.declarer : game.currentActor;
  return decider === view.yourSeat && view.seats[view.yourSeat].kind === "human";
}

/** A legal action for the viewer's turn, chosen by a bot from the viewer's visible cards only. */
async function chooseFromView(view: TableView): Promise<GameAction> {
  const game = view.game!;
  const seat = game.currentActor;
  const bot = createBot({ skill: "advanced", biddingStyle: "SAYC" });
  if (game.phase === "auction") return { type: "bid", seat, bid: await bot.chooseBid(game.hands[seat], game.auction, seat) };
  return { type: "play", seat, card: await bot.chooseCard(playContextFor(game as unknown as GameState, seat)) };
}

describe("lobby", () => {
  it("lists a created listed table and not an unlisted one", async () => {
    const listed = await newTableId(true, "Open table");
    const hidden = await newTableId(false, "Private table");
    const tables = await listTables();
    expect(tables.map((t) => t.id)).toContain(listed);
    expect(tables.map((t) => t.id)).not.toContain(hidden);
    const entry = tables.find((t) => t.id === listed)!;
    expect(entry).toMatchObject({ name: "Open table", style: "SAYC", handInProgress: false });
    expect(entry.seats.north).toEqual({ kind: "empty" });
  });

  it("refuses a bad name or style", async () => {
    expect((await createTable({ name: "  ", style: "SAYC", listed: true })).status).toBe(400);
    expect((await createTable({ name: "x".repeat(41), style: "SAYC", listed: true })).status).toBe(400);
    expect((await createTable({ name: "Fine", style: "Acol", listed: true })).status).toBe(400);
    expect((await SELF.fetch("https://x/api/tables", { method: "POST", body: "{not json" })).status).toBe(400);
  });

  it("refuses an oversized creation body, whether its length is declared or streamed", async () => {
    const padded = { name: "Big", style: "SAYC", listed: true, padding: "x".repeat(5000) };
    expect((await createTable(padded)).status).toBe(400);
    const chunk = new TextEncoder().encode(" ".repeat(1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // an endless body: the server must stop reading at the limit
        sent += 1;
        controller.enqueue(chunk);
        if (sent > 10_000) controller.close();
      }
    });
    const streamed = await SELF.fetch("https://x/api/tables", { method: "POST", body: stream, headers: { "CF-Connecting-IP": freshIp() } });
    expect(streamed.status).toBe(400);
    expect(sent).toBeLessThan(100);
    // a body within the limit is still accepted
    expect((await createTable({ name: "Small", style: "SAYC", listed: false, padding: "x".repeat(3000) })).status).toBe(201);
  });

});

describe("connections", () => {
  it("answers a wrong protocol version with reload and closes, even when the rest of the hello is invalid", async () => {
    const id = await newTableId();
    for (const hello of [{ type: "hello", version: 99, secret: SECRET_A, name: "Alice" }, { type: "hello", version: 2 }]) {
      const client = await Client.open(id);
      client.send(hello);
      expect(await client.next()).toEqual({ type: "reload" });
      await client.waitClosed();
    }
  });

  it("answers an unknown table with gone and closes", async () => {
    for (const id of ["NOSUCH", "ABCDEF"]) {
      const client = await Client.open(id);
      client.send({ type: "hello", version: 1, secret: SECRET_A, name: "Alice" });
      expect(await client.next()).toEqual({ type: "gone" });
      await client.waitClosed();
    }
  });

  it("refuses a malformed message with bad-message and keeps the socket", async () => {
    const id = await newTableId();
    const { client } = await Client.join(id, SECRET_A, "Alice");
    client.send({ type: "sit", seat: "middle" } as Record<string, unknown>);
    const refused = await client.next();
    expect(refused).toMatchObject({ type: "refused", reason: "bad-message" });
    client.send({ type: "sit", seat: "north" });
    const view = await client.viewAfter(0);
    expect(view.yourSeat).toBe("north");
    expect(view.seats.north).toMatchObject({ kind: "human", name: "Alice", away: false });
  });

  it("closes the socket on a frame over 4096 bytes or a binary frame", async () => {
    const id = await newTableId();
    const { client } = await Client.join(id, SECRET_A, "Alice");
    client.ws.send(JSON.stringify({ type: "leave", pad: "x".repeat(5000) }));
    await client.waitClosed();
    const { client: other } = await Client.join(id, SECRET_B, "Bob");
    other.ws.send(new Uint8Array([1, 2, 3]));
    await other.waitClosed();
  });

  it("keeps a seat present while a second connection with the same secret stays open", async () => {
    const id = await newTableId();
    const { client: first } = await Client.join(id, SECRET_A, "Alice");
    first.send({ type: "sit", seat: "north" });
    await first.viewAfter(0);
    const { client: second } = await Client.join(id, SECRET_A, "Alice");
    first.close();
    // the only event after the second hello is the first socket's close
    const afterClose = await second.next();
    expect(afterClose.type).toBe("view");
    expect(afterClose.type === "view" && afterClose.view.seats.north).toMatchObject({ kind: "human", name: "Alice", away: false });
  });
});

describe("ids and limits", () => {
  it("gives unlisted tables 12-character ids and matches ids case-insensitively", async () => {
    for (const listed of [true, false]) {
      const id = await newTableId(listed);
      const { view } = await Client.join(id.toLowerCase(), SECRET_A, "Alice");
      expect(view).toMatchObject({ id, listed });
    }
  });

  it("refuses a 33rd greeted socket to one table with 429", async () => {
    const id = await newTableId(false);
    const ips = ["10.200.0.1", "10.200.0.2", "10.200.0.3", "10.200.0.4"];
    for (let i = 0; i < 32; i++) await Client.join(id, SECRET_A, "Alice", ips[i % 4]);
    expect((await upgrade(id, "10.200.0.5")).status).toBe(429);
  });

  it("refuses a 17th socket that has not sent hello with 429", async () => {
    const id = await newTableId(false);
    for (let i = 1; i <= 16; i++) await Client.open(id, `10.201.0.${i}`);
    expect((await upgrade(id, "10.201.0.17")).status).toBe(429);
  });

  it("refuses a 3rd socket without hello from one IP while another IP can still open one", async () => {
    const id = await newTableId(false);
    await Client.open(id, "10.205.0.1");
    await Client.open(id, "10.205.0.1");
    expect((await upgrade(id, "10.205.0.1")).status).toBe(429);
    await Client.open(id, "10.205.0.2");
    // once a pending socket completes hello, that IP may open another
    const { client } = await Client.join(id, SECRET_A, "Alice", "10.205.0.3");
    client.send({ type: "sit", seat: "north" });
    await client.viewAfter(0);
  });

  it("refuses a 9th socket from one IP while another IP still connects", async () => {
    const id = await newTableId(false);
    for (let i = 0; i < 8; i++) await Client.join(id, SECRET_A, "Alice", "10.202.0.1");
    expect((await upgrade(id, "10.202.0.1")).status).toBe(429);
    const { view } = await Client.join(id, SECRET_B, "Bob", "10.202.0.2");
    expect(view.yourSeat).toBeUndefined();
  });

  it("closes a socket that has not sent hello within 10 s, but not a greeted one", async () => {
    fakeClock();
    const id = await newTableId(false);
    const { client: greeted } = await Client.join(id, SECRET_A, "Alice");
    const pending = await Client.open(id, "10.203.0.1");
    vi.setSystemTime(Date.now() + 9_999);
    expect(await runDurableObjectAlarm(stubFor(id))).toBe(true);
    expect(pending.closed).toBe(false);
    vi.setSystemTime(Date.now() + 1);
    expect(await runDurableObjectAlarm(stubFor(id))).toBe(true);
    await pending.waitClosed();
    greeted.send({ type: "sit", seat: "north" });
    expect((await greeted.viewAfter(0)).yourSeat).toBe("north");
  });

  it("caps listed and unlisted tables separately", async () => {
    const lobby = env.LOBBY.get(env.LOBBY.idFromName("lobby"));
    await runInDurableObject(lobby, async (instance: LobbyObject, state) => {
      expect(instance.limits).toEqual({ listed: 100, unlisted: 400 });
      const listed = (await state.storage.list({ prefix: "listed:" })).size;
      const unlisted = (await state.storage.list({ prefix: "unlisted:" })).size;
      const make = (listedTable: boolean) => instance.createTable({ name: "Capped", style: "SAYC", listed: listedTable }, `client-${freshIp()}`);
      try {
        // unlisted full: unlisted refused, listed still created
        instance.limits = { listed: listed + 1, unlisted };
        expect(await make(false)).toEqual({ error: "too-many-tables" });
        expect(await make(true)).toHaveProperty("id");
        // listed full: listed refused, unlisted still created
        instance.limits = { listed: listed + 1, unlisted: unlisted + 1 };
        expect(await make(true)).toEqual({ error: "too-many-tables" });
        expect(await make(false)).toHaveProperty("id");
      } finally {
        instance.limits = { listed: 100, unlisted: 400 };
      }
    });
  });

  it("limits creation to 10 tables per client IP per rolling hour", async () => {
    fakeClock();
    const body = { name: "Mine", style: "SAYC", listed: false };
    expect((await createTable({ name: "  ", style: "SAYC", listed: false }, "10.204.0.1")).status).toBe(400);
    for (let i = 0; i < 10; i++) expect((await createTable(body, "10.204.0.1")).status).toBe(201);
    const refused = await createTable(body, "10.204.0.1");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "too-many-requests" });
    expect((await createTable(body, "10.204.0.2")).status).toBe(201);
    vi.setSystemTime(Date.now() + 3_600_000);
    expect((await createTable(body, "10.204.0.1")).status).toBe(201);
  });
});

describe("creation-rate record", () => {
  it("keys each client by a salted hash, never the raw or plainly hashed address", async () => {
    const ip = "10.208.0.1";
    expect((await createTable({ name: "Salted", style: "SAYC", listed: false }, ip)).status).toBe(201);
    const plain = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await runInDurableObject(env.LOBBY.get(env.LOBBY.idFromName("lobby")), async (_instance, state) => {
      const salt = await state.storage.get<Uint8Array>("salt");
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt!.length).toBe(32);
      const keys = [...(await state.storage.list({ prefix: "rate:" })).keys()];
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(key).toMatch(/^rate:[0-9a-f]{64}$/);
      expect(keys).not.toContain(`rate:${plain}`);
      expect(keys.some((key) => key.includes(ip))).toBe(false);
    });
  });
});

describe("presence on the server", () => {
  it("a socket closing before hello changes no presence", async () => {
    const id = await newTableId();
    const { client: a } = await Client.join(id, SECRET_A, "Alice");
    a.send({ type: "sit", seat: "north" });
    await a.viewAfter(0);
    const before = await storedState(id);
    const stranger = await Client.open(id);
    await socketsSettle(id, 2);
    stranger.close();
    await socketsSettle(id, 1);
    const after = await storedState(id);
    expect(after!.connections).toEqual(before!.connections);
    expect(Object.values(after!.connections)).toEqual([1]);
    expect(after!.awaySince).toEqual({});
    expect(after!.revision).toBe(before!.revision);
  });

  it("reconciles sockets lost in a restart from the alarm alone, then expires and leaves the lobby", async () => {
    fakeClock();
    const id = await newTableId();
    const { client: a } = await Client.join(id, SECRET_A, "Alice");
    a.send({ type: "sit", seat: "north" });
    await a.viewAfter(0);
    await evict(id, "close");
    await a.waitClosed();
    // nobody comes back: only the backstop alarm can notice
    expect(Object.values((await storedState(id))!.connections)).toEqual([1]);
    expect(await runDurableObjectAlarm(stubFor(id))).toBe(true);
    const reconciled = (await storedState(id))!;
    expect(reconciled.connections).toEqual({});
    expect(Object.keys(reconciled.awaySince)).toHaveLength(1);
    expect((await listTables()).find((t) => t.id === id)!.seats.north).toMatchObject({ away: true });
    vi.setSystemTime(Date.now() + EMPTY_TABLE_MS);
    expect(await runDurableObjectAlarm(stubFor(id))).toBe(true);
    expect(await storedState(id)).toBeUndefined();
    expect((await listTables()).map((t) => t.id)).not.toContain(id);
  });

  it("does not delay a due bot when a new socket connects", async () => {
    fakeClock();
    // an hour ahead, so no alarm comes due by the real clock while this test moves the faked one
    vi.setSystemTime(Date.now() + 3_600_000);
    const id = await newTableId();
    const { client: a } = await Client.join(id, SECRET_A, "Alice");
    a.send({ type: "sit", seat: "south" });
    let view = await a.viewAfter(0);
    for (const seat of ["north", "east", "west"] as const) {
      a.send({ type: "setBot", seat, skill: "advanced" });
      view = await a.viewAfter(view.revision);
    }
    a.send({ type: "deal" });
    view = await a.viewAfter(view.revision);
    expect(view.game!.currentActor).toBe("north");
    const dealt = (await storedState(id))!;
    const due = dealt.turnSince + BOT_PAUSE_MS;
    const alarmAt = () => runInDurableObject(stubFor(id), (_instance, state) => state.storage.getAlarm());
    expect(await alarmAt()).toBe(due);
    vi.setSystemTime(due);
    await Client.open(id, "10.206.0.1");
    expect(await alarmAt()).toBe(due);
    expect(await runDurableObjectAlarm(stubFor(id))).toBe(true);
    expect((await storedState(id))!.revision).toBe(dealt.revision + 1);
  });

  it("does not delay a due bot when players connect and disconnect before it is due", async () => {
    fakeClock();
    // the runtime fires alarms by the real clock (while handlers see the faked one); an hour ahead,
    // no alarm comes due for real while this test moves the clock, so only the test runs the alarm
    vi.setSystemTime(Date.now() + 3_600_000);
    const id = await newTableId();
    const { client: a } = await Client.join(id, SECRET_A, "Alice");
    a.send({ type: "sit", seat: "south" });
    let view = await a.viewAfter(0);
    for (const seat of ["north", "east", "west"] as const) {
      a.send({ type: "setBot", seat, skill: "advanced" });
      view = await a.viewAfter(view.revision);
    }
    a.send({ type: "deal" });
    view = await a.viewAfter(view.revision);
    expect(view.game!.currentActor).toBe("north");
    const dealt = (await storedState(id))!;
    const due = dealt.turnSince + BOT_PAUSE_MS;
    const alarmAt = () => runInDurableObject(stubFor(id), (_instance, state) => state.storage.getAlarm());
    const connections = async () => Object.keys((await storedState(id))!.connections).length;
    // a completed hello (a connect event) 100 ms before the bot is due leaves the alarm alone
    vi.setSystemTime(due - 100);
    const { client: b } = await Client.join(id, SECRET_B, "Bob", "10.207.0.1");
    expect(await connections()).toBe(2);
    expect(await alarmAt()).toBe(due);
    // repeated connects and disconnects before the bot is due do not postpone it either
    b.close();
    for (let i = 0; i < 100 && await connections() !== 1; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await alarmAt()).toBe(due);
    for (let round = 0; round < 3; round++) {
      vi.setSystemTime(due - 50 + round * 10);
      const { client } = await Client.join(id, SECRET_B, "Bob", `10.207.1.${round}`);
      expect(await alarmAt()).toBe(due);
      client.close();
      for (let i = 0; i < 100 && await connections() !== 1; i++) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await connections()).toBe(1);
      expect(await alarmAt()).toBe(due);
    }
    // the bot then acts on time
    vi.setSystemTime(due);
    expect(await runDurableObjectAlarm(stubFor(id))).toBe(true);
    expect((await storedState(id))!.revision).toBe(dealt.revision + 1);
  });

  it("re-arms one bot pause later, not at once, when a due bot's action is refused", async () => {
    fakeClock();
    vi.setSystemTime(Date.now() + 3_600_000);
    const id = await newTableId();
    const { client: a } = await Client.join(id, SECRET_A, "Alice");
    a.send({ type: "sit", seat: "south" });
    let view = await a.viewAfter(0);
    for (const seat of ["north", "east", "west"] as const) {
      a.send({ type: "setBot", seat, skill: "advanced" });
      view = await a.viewAfter(view.revision);
    }
    a.send({ type: "deal" });
    await a.viewAfter(view.revision);
    const dealt = (await storedState(id))!;
    type Dispatch = (event: { type: string }) => Promise<{ state: TableState; refused?: string }>;
    await runInDurableObject(stubFor(id), (instance) => {
      const target = instance as unknown as { dispatch: Dispatch };
      const original = target.dispatch.bind(instance);
      target.dispatch = async (event) => event.type === "bot" ? { state: (await storedState(id))!, refused: "stale" } : original(event);
    });
    const alarmAt = () => runInDurableObject(stubFor(id), (_instance, state) => state.storage.getAlarm());
    for (let round = 0; round < 3; round++) {
      vi.setSystemTime(dealt.turnSince + BOT_PAUSE_MS + round * 5_000);
      expect(await runDurableObjectAlarm(stubFor(id))).toBe(true);
      expect((await storedState(id))!.revision).toBe(dealt.revision);
      expect(await alarmAt()).toBe(Date.now() + BOT_PAUSE_MS);
    }
    await runInDurableObject(stubFor(id), (instance) => { delete (instance as unknown as { dispatch?: Dispatch }).dispatch; });
  });

  it("keeps a stored and sent change when the lobby update fails, and a later change repairs the lobby row", async () => {
    const id = await newTableId();
    const { client: a } = await Client.join(id, SECRET_A, "Alice");
    type Patched = { lobby?: () => { update(): Promise<void> } };
    await runInDurableObject(stubFor(id), (instance) => {
      (instance as unknown as Patched).lobby = () => ({ update: () => Promise.reject(new Error("lobby unavailable")) });
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    onTestFinished(() => { warn.mockRestore(); });
    a.send({ type: "sit", seat: "north" });
    const seated = await a.viewAfter(0);
    expect(seated.yourSeat).toBe("north");
    expect((await storedState(id))!.seats.north.kind).toBe("human");
    expect(warn).toHaveBeenCalledWith("table: lobby update failed; a later seat or score change will repair it");
    expect((await listTables()).find((t) => t.id === id)!.seats.north).toEqual({ kind: "empty" });
    await runInDurableObject(stubFor(id), (instance) => { delete (instance as unknown as Patched).lobby; });
    a.send({ type: "setBot", seat: "east", skill: "advanced" });
    await a.viewAfter(seated.revision);
    const row = (await listTables()).find((t) => t.id === id)!;
    expect(row.seats.north.kind).toBe("human");
    expect(row.seats.east.kind).toBe("bot");
  });

  it("does not let a bot act before its pause is over, even when the alarm fires early", async () => {
    fakeClock();
    const id = await newTableId();
    const { client: a } = await Client.join(id, SECRET_A, "Alice");
    a.send({ type: "sit", seat: "south" });
    let view = await a.viewAfter(0);
    for (const seat of ["north", "east", "west"] as const) {
      a.send({ type: "setBot", seat, skill: "advanced" });
      view = await a.viewAfter(view.revision);
    }
    a.send({ type: "deal" });
    view = await a.viewAfter(view.revision);
    expect(view.game!.currentActor).toBe("north");
    const dealt = (await storedState(id))!.revision;
    // early: the alarm runs, the bot does not act, and the alarm is set again
    expect(await runDurableObjectAlarm(stubFor(id))).toBe(true);
    expect((await storedState(id))!.revision).toBe(dealt);
    vi.setSystemTime(Date.now() + BOT_PAUSE_MS - 1);
    expect(await runDurableObjectAlarm(stubFor(id))).toBe(true);
    expect((await storedState(id))!.revision).toBe(dealt);
    // due: the bot acts once
    vi.setSystemTime(Date.now() + 1);
    expect(await runDurableObjectAlarm(stubFor(id))).toBe(true);
    expect((await storedState(id))!.revision).toBe(dealt + 1);
  });
});

describe("a hand at an online table", () => {
  it("deals, plays to the end, survives a reconnect, hibernation, and a restart, and never shows hidden cards", { timeout: 120_000 }, async () => {
    fakeClock();
    const id = await newTableId();
    let { client: a } = await Client.join(id, SECRET_A, "Alice");
    const { client: b, view: bFirst } = await Client.join(id, SECRET_B, "Bob");
    expect(bFirst.yourSeat).toBeUndefined();

    a.send({ type: "sit", seat: "south" });
    let view = await a.viewAfter(0);
    for (const seat of ["north", "east", "west"] as const) {
      a.send({ type: "setBot", seat, skill: "advanced" });
      view = await a.viewAfter(view.revision);
    }
    expect((await listTables()).find((t) => t.id === id)!.seats.south).toMatchObject({ kind: "human", name: "Alice" });

    let lastAct: ClientMessage | undefined;
    let reconnected = false, hibernated = false, restarted = false;
    // deals are random, so keep dealing until each check has had a hand in play to run in
    for (let hand = 1; hand <= 12 && !(reconnected && hibernated && restarted); hand++) {
      expect(view.canDeal).toBe(true);
      a.send({ type: "deal" });
      view = await a.viewAfter(view.revision);
      expect(view.handNumber).toBe(hand);
      expect(view.game!.hands.south).toHaveLength(13);
      for (const seat of ["north", "east", "west"] as const) expect(view.game!.hands[seat]).toEqual([]);

      while (!view.revealed) {
        const inPlay = view.game!.phase === "play";
        if (viewerActs(view) && inPlay && !reconnected && lastAct) {
          // drop A's connection on A's turn; B sees A's seat go away once the server has processed the close
          reconnected = true;
          a.close();
          await b.until((v) => v.seats.south.kind === "human" && v.seats.south.away);
          const before = view;
          ({ client: a, view } = await Client.join(id, SECRET_A, "Alice"));
          expect(view.handNumber).toBe(before.handNumber);
          expect(view.revision).toBeGreaterThanOrEqual(before.revision);
          expect(view.game!.hands.south).toEqual(before.game!.hands.south);
          expect(view.seats.south).toMatchObject({ away: false });
          // the last accepted action, sent again, is stale and changes nothing
          a.send(lastAct);
          const stale = await a.next();
          expect(stale).toMatchObject({ type: "refused", reason: "stale" });
          expect(stale.type === "refused" && stale.view.game).toEqual(view.game);
        } else if (viewerActs(view)) {
          const action = await chooseFromView(view);
          lastAct = { type: "act", handNumber: view.handNumber, revision: view.revision, action };
          a.send(lastAct);
          view = await a.viewAfter(view.revision);
        } else if (inPlay && !hibernated) {
          // evict with sockets hibernated: the next event must recover the state from storage and each socket's player
          hibernated = true;
          await evict(id, "hibernate");
          // A's hibernated socket still identifies A: a resent action is answered with A's own view
          a.send(lastAct!);
          let answer = await a.next();
          while (answer.type === "view") answer = await a.next();
          expect(answer).toMatchObject({ type: "refused", reason: "stale", view: { yourSeat: "south", revision: view.revision } });
          expect(answer.type === "refused" && answer.view.game!.hands.south).toEqual(view.game!.hands.south);
        } else if (inPlay && reconnected && hibernated && !restarted) {
          // restart: evict with sockets closed, reconnect; the view must match the last one
          restarted = true;
          await evict(id, "close");
          await a.waitClosed();
          const before = view;
          ({ client: a, view } = await Client.join(id, SECRET_A, "Alice"));
          expect(view.revision).toBe(before.revision);
          expect(view.handNumber).toBe(before.handNumber);
          expect(view.game).toEqual(before.game);
          expect(view.totals).toEqual(before.totals);
          // the sockets lost in the restart were reconciled away: only A's new connection is counted
          const stored = await storedState(id);
          expect(Object.values(stored!.connections)).toEqual([1]);
        } else {
          await runAlarmWhenDue(id);
          view = await a.viewAfter(view.revision);
        }
      }

      const game = view.game!;
      if (game.phase === "complete") expect(view.totals.ns + view.totals.ew).toBeGreaterThan(0);
      else expect(game.phase).toBe("passed-out");
      expect(view.revealed!.south).toHaveLength(13);
    }
    expect([reconnected, hibernated, restarted]).toEqual([true, true, true]);

    // B, unseated, never received a game, a revealed deal, or any card
    expect(b.received.length).toBeGreaterThan(5);
    for (const message of b.received) {
      expect(message.type).toBe("view");
      const text = JSON.stringify(message);
      expect(text).not.toContain("\"suit\"");
      expect(text).not.toContain("\"game\"");
      expect(text).not.toContain("\"revealed\"");
    }
  });
});

describe("expiry", () => {
  it("removes a table nobody ever connected to after 10 minutes", async () => {
    fakeClock();
    const id = await newTableId();
    vi.setSystemTime(Date.now() + 599_999);
    expect(await runDurableObjectAlarm(stubFor(id))).toBe(true);
    expect((await listTables()).map((t) => t.id)).toContain(id);
    vi.setSystemTime(Date.now() + 1);
    expect(await runDurableObjectAlarm(stubFor(id))).toBe(true);
    expect((await listTables()).map((t) => t.id)).not.toContain(id);
    expect(await storedState(id)).toBeUndefined();
  });

  it("deletes a table with nobody connected for 24 hours and removes it from the lobby", async () => {
    const id = await newTableId();
    const stub = stubFor(id);
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = await state.storage.get<TableState>("state");
      await state.storage.put("state", { ...stored!, lastHumanAt: Date.now() - 86_400_000 });
    });
    await evict(id, "hibernate");
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await listTables()).map((t) => t.id)).not.toContain(id);
    const client = await Client.open(id);
    client.send({ type: "hello", version: 1, secret: SECRET_A, name: "Alice" });
    expect(await client.next()).toEqual({ type: "gone" });
  });
});

describe("lobby cap", () => {
  it("caps listed tables at 100 but still allows unlisted ones", async () => {
    const existing = (await listTables()).length;
    for (let i = existing; i < 100; i++) await newTableId(true, `Table ${i}`);
    const refused = await createTable({ name: "One too many", style: "2/1", listed: true });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "too-many-tables" });
    await newTableId(false, "Still fine");
    expect(await listTables()).toHaveLength(100);
  });
});
