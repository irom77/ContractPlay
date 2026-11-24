import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { PROTOCOL_VERSION } from "@contractplay/protocol";
import type { ServerMessage, TableView } from "@contractplay/protocol";
import type { TableState } from "@contractplay/table";
import migration from "../migrations/0001_auth.sql?raw";
import archiveMigration from "../migrations/0003_deal_archive.sql?raw";
import worker from "./index.js";
import { AuthStore } from "./auth-store.js";
import { DealArchive } from "./deal-archive.js";
import { createDeck, deal } from "@contractplay/core";
import type { GameAction } from "@contractplay/core";

const origin = "https://bridge.example";
const config = { ...env, AUTH_PUBLIC_ORIGIN: origin };
const store = new AuthStore(env.DB);
const secretA = "a".repeat(43);
const secretB = "b".repeat(43);
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, "0")).join("");
const stored = (id: string) => runInDurableObject(env.TABLES.get(env.TABLES.idFromName(id)), (_instance, state) => state.storage.get<TableState>("state"));

const sql = (text: string) => text.replace(/--[^\n]*/g, "").replace(/\n/g, " ");
beforeAll(async () => {
  await env.DB.exec(migration.replace(/\n/g, " "));
  await env.DB.exec(sql(archiveMigration));
});
beforeEach(async () => {
  await env.DB.batch(["deal_results", "archived_deals", "sessions", "account_player_identities", "accounts"].map((name) => env.DB.prepare(`DELETE FROM ${name}`)));
});

async function table(): Promise<string> {
  const response = await worker.fetch(new Request(`${origin}/api/tables`, {
    method: "POST", headers: { "CF-Connecting-IP": crypto.randomUUID() },
    body: JSON.stringify({ name: "Account seats", style: "SAYC", listed: false })
  }), config);
  expect(response.status).toBe(201);
  return (await response.json<{ id: string }>()).id;
}

async function account(linked: string[] = []) {
  const email = `${crypto.randomUUID()}@example.com`;
  let account = await store.getOrCreateAccount(email, "Account name", Date.now(), linked[0]);
  for (const player of linked.slice(1)) account = await store.getOrCreateAccount(email, "Account name", Date.now(), player);
  const credential = "s".repeat(43);
  const sessionHash = await hash(credential);
  await env.DB.prepare("INSERT OR REPLACE INTO sessions (session_hash, account_id, expires_at) VALUES (?, ?, ?)")
    .bind(sessionHash, account.id, Date.now() + 60_000).run();
  return { account, sessionHash, cookie: `__Host-contractplay_session=${credential}` };
}

async function socket(id: string, headers: Record<string, string> = {}, query = "") {
  const response = await worker.fetch(new Request(`${origin}/api/tables/${id}/ws${query}`, {
    headers: { Upgrade: "websocket", Origin: origin, "CF-Connecting-IP": crypto.randomUUID(), ...headers }
  }), config);
  expect(response.status).toBe(101);
  const ws = response.webSocket!;
  ws.accept();
  onTestFinished(() => { if (ws.readyState === WebSocket.OPEN) ws.close(); });
  const messages: ServerMessage[] = [];
  let notify: (() => void) | undefined;
  ws.addEventListener("message", (event) => { messages.push(JSON.parse(event.data as string)); notify?.(); });
  const next = async (): Promise<ServerMessage> => {
    if (!messages.length) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no server message")), 1000);
      notify = () => { clearTimeout(timer); resolve(); };
    });
    return messages.shift()!;
  };
  const view = async (): Promise<TableView> => {
    const message = await next();
    expect(message.type).toBe("view");
    if (message.type !== "view") throw new Error(`Expected view: ${JSON.stringify(message)}`);
    return message.view;
  };
  return { ws, next, view, send: (data: Record<string, unknown>) => ws.send(JSON.stringify(data)) };
}

async function seatGuest(id: string, secret: string, seat: "north" | "east") {
  const client = await socket(id);
  client.send({ type: "hello", version: PROTOCOL_VERSION, secret, name: "Guest name" });
  await client.view();
  client.send({ type: "sit", seat });
  expect((await client.view()).yourSeat).toBe(seat);
  return client;
}

const accountHello = { type: "hello", version: PROTOCOL_VERSION, name: "Untrusted name" };

describe("authenticated table identities", () => {
  it("rejects a reconnect captured for A after the session changes to B or disappears", async () => {
    const id = await table();
    const first = await account();
    const initial = await socket(id, { Cookie: first.cookie });
    initial.send({ ...accountHello, expectedPlayerId: first.account.primaryPlayerId });
    await initial.view();
    const second = await account();
    const before = await stored(id);
    for (const headers of [{ Cookie: second.cookie }, {}]) {
      const reconnect = await socket(id, headers);
      reconnect.send({ ...accountHello, expectedPlayerId: first.account.primaryPlayerId });
      expect(await reconnect.next()).toEqual({ type: "account-changed" });
      expect(await stored(id)).toEqual(before);
    }
    const missingExpectation = await socket(id, { Cookie: second.cookie });
    missingExpectation.send(accountHello);
    expect(await missingExpectation.next()).toEqual({ type: "account-changed" });
    expect(await stored(id)).toEqual(before);
  });
  it("reloads the previous protocol before accepting an account identity", async () => {
    const id = await table();
    const auth = await account();
    const client = await socket(id, { Cookie: auth.cookie });
    client.send({ ...accountHello, version: PROTOCOL_VERSION - 1 });
    expect(await client.next()).toEqual({ type: "reload" });
    expect((await stored(id))?.connections).toEqual({});
  });

  it("uses a new account's random stable primary player ID and verified name", async () => {
    const id = await table();
    const auth = await account();
    const client = await socket(id, { Cookie: auth.cookie });
    client.send({ ...accountHello, expectedPlayerId: auth.account.primaryPlayerId });
    expect((await client.view()).yourSeat).toBeUndefined();
    client.send({ type: "sit", seat: "north" });
    expect((await client.view()).seats.north).toMatchObject({ kind: "human", name: "Account name" });
    expect((await stored(id))?.seats.north).toMatchObject({ player: auth.account.primaryPlayerId });
  });

  it("recovers the uniquely seated linked guest across devices and hibernation", async () => {
    const id = await table();
    const guest = await seatGuest(id, secretB, "east");
    const guestPlayer = await hash(secretB);
    const auth = await account([await hash(secretA), guestPlayer]);
    const client = await socket(id, { Cookie: auth.cookie });
    client.send({ ...accountHello, expectedPlayerId: auth.account.primaryPlayerId });
    const view = await client.view();
    expect(view.yourSeat).toBe("east");
    expect(view.seats.east).toMatchObject({ away: false });
    expect((await stored(id))?.connections[guestPlayer]).toBe(2);
    expect((await stored(id))?.connections[auth.account.primaryPlayerId]).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain(auth.account.id);
    expect(JSON.stringify(view)).not.toContain(auth.account.email);
    await evictDurableObject(env.TABLES.get(env.TABLES.idFromName(id)), { webSockets: "hibernate" });
    client.send({ type: "refresh" });
    expect((await client.view()).yourSeat).toBe("east");
    guest.ws.close();
    client.ws.close();
    for (let i = 0; i < 50 && (await stored(id))?.connections[guestPlayer]; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await stored(id))?.connections[guestPlayer]).toBeUndefined();
    const reconnected = await socket(id, { Cookie: auth.cookie });
    reconnected.send({ ...accountHello, expectedPlayerId: auth.account.primaryPlayerId });
    expect((await reconnected.view()).yourSeat).toBe("east");
    expect((await stored(id))?.connections[guestPlayer]).toBe(1);
  });

  it("uses the primary identity when none of the linked identities is seated", async () => {
    const id = await table();
    const auth = await account([await hash(secretA), await hash(secretB)]);
    const client = await socket(id, { Cookie: auth.cookie });
    client.send({ ...accountHello, expectedPlayerId: auth.account.primaryPlayerId });
    await client.view();
    expect((await stored(id))?.connections).toEqual({ [auth.account.primaryPlayerId]: 1 });
  });

  it("rejects multiple linked seats without taking control of either seat", async () => {
    const id = await table();
    await seatGuest(id, secretA, "north");
    await seatGuest(id, secretB, "east");
    const auth = await account([await hash(secretA), await hash(secretB)]);
    const before = await stored(id);
    const client = await socket(id, { Cookie: auth.cookie });
    client.send({ ...accountHello, expectedPlayerId: auth.account.primaryPlayerId });
    expect(await client.next()).toEqual({ type: "identity-conflict" });
    expect(await stored(id)).toEqual(before);
  });

  it("ignores a guest secret in an authenticated hello", async () => {
    const id = await table();
    await seatGuest(id, secretB, "east");
    const auth = await account();
    const client = await socket(id, { Cookie: auth.cookie });
    client.send({ ...accountHello, expectedPlayerId: auth.account.primaryPlayerId, secret: secretB });
    expect((await client.view()).yourSeat).toBeUndefined();
    expect((await stored(id))?.connections[auth.account.primaryPlayerId]).toBe(1);
  });

  it("strips forged public account headers and ignores account IDs in the URL", async () => {
    const id = await table();
    const auth = await account();
    const client = await socket(id, { "X-ContractPlay-Account": JSON.stringify({ id: auth.account.id, primaryPlayerId: auth.account.primaryPlayerId, displayName: "Account name" }) }, `?accountId=${auth.account.id}&playerId=${auth.account.primaryPlayerId}`);
    client.send({ ...accountHello, expectedPlayerId: auth.account.primaryPlayerId });
    expect(await client.next()).toEqual({ type: "account-changed" });
    const guest = await socket(id);
    guest.send({ ...accountHello, secret: secretA });
    await guest.view();
    expect((await stored(id))?.connections).toEqual({ [await hash(secretA)]: 1 });
  });

  it("does not authenticate revoked or expired session cookies", async () => {
    for (const revoked of [true, false]) {
      const id = await table();
      const auth = await account();
      if (revoked) await store.revokeSession(auth.sessionHash, Date.now());
      else await env.DB.prepare("UPDATE sessions SET expires_at = 0 WHERE session_hash = ?").bind(auth.sessionHash).run();
      const client = await socket(id, { Cookie: auth.cookie });
      client.send({ ...accountHello, expectedPlayerId: auth.account.primaryPlayerId });
      expect(await client.next()).toEqual({ type: "account-changed" });
      expect((await stored(id))?.connections).toEqual({});
    }
  });

  it("rejects cross-origin cookie upgrades", async () => {
    const id = await table();
    const auth = await account();
    const response = await worker.fetch(new Request(`${origin}/api/tables/${id}/ws`, {
      headers: { Upgrade: "websocket", Cookie: auth.cookie, Origin: "https://evil.example" }
    }), config);
    expect(response.status).toBe(403);
  });
});

describe("deal replays at online tables", () => {
  const passedOut = (dealer: "north" | "east" | "south" | "west"): GameAction[] => {
    const order = ["north", "east", "south", "west"] as const;
    const start = order.indexOf(dealer);
    return [0, 1, 2, 3].map((n) => ({ type: "bid", seat: order[(start + n) % 4]!, bid: "pass" }));
  };
  /** The stored results; the table writes them just after it broadcasts a finished hand, so wait for `count` of them. */
  const results = async (count = 0) => {
    for (let n = 0; n < 100; n++) {
      const rows = (await env.DB.prepare("SELECT deal_id, source FROM deal_results").all()).results;
      if (rows.length >= count) return rows;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("results not written");
  };

  async function seatedFour(id: string) {
    const clients: Array<{ seat: "north" | "east" | "south" | "west"; client: Awaited<ReturnType<typeof socket>> }> = [];
    // Closing four seated sockets sets off lobby and alarm work in the table; let it finish before the test environment goes.
    onTestFinished(async () => {
      for (const { client } of clients) if (client.ws.readyState === WebSocket.OPEN) client.ws.close();
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    for (const [index, seat] of (["north", "east", "south", "west"] as const).entries()) {
      const client = await socket(id);
      client.send({ type: "hello", version: PROTOCOL_VERSION, secret: `${index}`.repeat(43), name: `Player ${seat}` });
      await client.view();
      client.send({ type: "sit", seat });
      await client.view();
      clients.push({ seat, client });
    }
    return clients;
  }
  const state = (id: string) => stored(id) as Promise<TableState>;
  const waitFor = async (id: string, done: (s: TableState) => boolean) => {
    for (let n = 0; n < 100; n++) { const s = await state(id); if (done(s)) return s; await new Promise((r) => setTimeout(r, 10)); }
    throw new Error("state not reached");
  };
  /** Deals a hand and has everyone pass it out; resolves with the finished state. */
  async function playPassedOut(id: string, clients: Awaited<ReturnType<typeof seatedFour>>) {
    const before = await state(id);
    clients[0]!.client.send({ type: "deal" });
    let current = await waitFor(id, (s) => s.handNumber === before.handNumber + 1);
    const dealt = current;
    for (let n = 0; n < 4; n++) {
      const game = current.game!;
      const actor = clients.find((c) => c.seat === game.currentActor)!;
      actor.client.send({ type: "act", handNumber: current.handNumber, revision: current.revision, action: { type: "bid", seat: actor.seat, bid: "pass" } });
      const revision = current.revision;
      current = await waitFor(id, (s) => s.revision > revision);
    }
    expect(current.game!.phase).toBe("passed-out");
    return { dealt, finished: current };
  }

  it("records a finished online hand once, with its source", async () => {
    const id = await table();
    const clients = await seatedFour(id);
    const { finished } = await playPassedOut(id, clients);
    expect(await results(1)).toEqual([{ deal_id: expect.any(String), source: "online" }]);
    expect(finished.replay).toBeUndefined();
  });

  it("deals the second hand from an eligible archived deal and records its result against it", async () => {
    const seeded = deal(createDeck().reverse());
    const dealId = await new DealArchive(env.DB).record({ deal: seeded, dealer: "east", vulnerability: "None", actions: passedOut("east"), source: "solo", playedAt: 0 });
    const id = await table();
    const clients = await seatedFour(id);
    const first = await playPassedOut(id, clients);
    expect(first.dealt.replay).toBeUndefined();
    expect(first.dealt.game!.initialDeal).not.toEqual(seeded);
    const second = await playPassedOut(id, clients);
    expect(second.dealt.replay?.dealId).toBe(dealId);
    expect(second.dealt.game!.initialDeal).toEqual(seeded);
    expect(second.dealt.game!.dealer).toBe("east");
    const views: TableView[] = [];
    try { for (;;) views.push(await clients[0]!.client.view()); } catch { /* drained */ }
    expect(views.at(-1)!.replay).toMatchObject({ firstPlayedAt: 0, rescored: expect.any(Boolean) });
    expect((await results(3)).filter((row) => row.deal_id === dealId)).toHaveLength(2);
  });

  it("deals and finishes hands normally when the archive tables are missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(async () => { warn.mockRestore(); await env.DB.exec(sql(archiveMigration)); });
    await env.DB.exec("DROP TABLE deal_results; DROP TABLE archived_deals;");
    const id = await table();
    const clients = await seatedFour(id);
    expect((await playPassedOut(id, clients)).finished.game!.phase).toBe("passed-out");
    const second = await playPassedOut(id, clients);
    expect(second.dealt.replay).toBeUndefined();
    expect(second.finished.game!.phase).toBe("passed-out");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("deal archive"), expect.anything());
  });

  it("never reads or writes the archive at a duplicate session table", async () => {
    const pick = vi.spyOn(DealArchive.prototype, "pickReplay");
    onTestFinished(() => { pick.mockRestore(); });
    await new DealArchive(env.DB).record({ deal: deal(createDeck().reverse()), dealer: "north", vulnerability: "None", actions: passedOut("north"), source: "solo", playedAt: 0 });
    const created = await worker.fetch(new Request(`${origin}/api/sessions`, {
      method: "POST", headers: { "CF-Connecting-IP": crypto.randomUUID(), "content-type": "application/json" },
      body: JSON.stringify({ name: "Club", style: "SAYC", tableCount: 2, boardCount: 2, scoring: "matchpoints", listed: false })
    }), config);
    expect(created.status).toBe(201);
    const { tableIds } = await created.json<{ tableIds: string[] }>();
    const id = tableIds[0]!;
    const clients = await seatedFour(id);
    const { finished } = await playPassedOut(id, clients);
    expect(finished.sessionId).toBeDefined();
    expect(pick).not.toHaveBeenCalled();
    expect(await results(1)).toEqual([{ deal_id: expect.any(String), source: "solo" }]);
  });

  it("neither queries nor stores anything when a refused deal would have been a replay", async () => {
    const id = await table();
    const clients = await seatedFour(id);
    await playPassedOut(id, clients);
    const pick = vi.spyOn(DealArchive.prototype, "pickReplay");
    onTestFinished(() => { pick.mockRestore(); });
    const spectator = await socket(id);
    spectator.send({ type: "hello", version: PROTOCOL_VERSION, secret: "9".repeat(43), name: "Watcher" });
    await spectator.view();
    const before = await state(id);
    spectator.send({ type: "deal" });
    expect((await spectator.next()).type).toBe("refused");
    expect(pick).not.toHaveBeenCalled();
    const after = await state(id);
    expect(after.revision).toBe(before.revision);
    expect(after.replayBoard).toBeUndefined();
  });

  it("judges a deal again when the table changed while its replay was being picked", async () => {
    await new DealArchive(env.DB).record({ deal: deal(createDeck().reverse()), dealer: "east", vulnerability: "None", actions: passedOut("east"), source: "solo", playedAt: 0 });
    const id = await table();
    const clients = await seatedFour(id);
    await playPassedOut(id, clients);
    const real = DealArchive.prototype.pickReplay;
    const tableObject = await runInDurableObject(env.TABLES.get(env.TABLES.idFromName(id)), (instance) => instance as unknown as { dispatch(event: unknown): Promise<unknown> });
    const west = (await state(id)).seats.west;
    if (west.kind !== "human") throw new Error("west should be seated");
    let calls = 0;
    const pick = vi.spyOn(DealArchive.prototype, "pickReplay").mockImplementation(async function (this: DealArchive, ...args) {
      calls += 1;
      const found = await real.apply(this, args);
      // another message lands while the pick is pending (production lets it in at the D1 await): West leaves
      await tableObject.dispatch({ type: "message", player: west.player, message: { type: "leave" }, at: Date.now() });
      return found;
    });
    onTestFinished(() => { pick.mockRestore(); });
    clients[0]!.client.send({ type: "deal" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(calls).toBe(1);
    const settled = await state(id);
    // the deal was judged against the table as it now is (a seat empty), so it is refused and nothing stale is stored
    expect(settled.handNumber).toBe(1);
    expect(settled.seats.west.kind).toBe("empty");
    expect(settled.replayBoard).toBeUndefined();
  });

  it("keeps a disconnect that lands while a replay is being picked", async () => {
    await new DealArchive(env.DB).record({ deal: deal(createDeck().reverse()), dealer: "east", vulnerability: "None", actions: passedOut("east"), source: "solo", playedAt: 0 });
    const id = await table();
    const clients = await seatedFour(id);
    await playPassedOut(id, clients);
    const real = DealArchive.prototype.pickReplay;
    const tableObject = await runInDurableObject(env.TABLES.get(env.TABLES.idFromName(id)), (instance) => instance as unknown as { dispatch(event: unknown): Promise<unknown> });
    const west = (await state(id)).seats.west;
    if (west.kind !== "human") throw new Error("west should be seated");
    const pick = vi.spyOn(DealArchive.prototype, "pickReplay").mockImplementation(async function (this: DealArchive, ...args) {
      const found = await real.apply(this, args);
      // a disconnect changes the state without bumping its revision
      await tableObject.dispatch({ type: "disconnect", player: west.player, at: Date.now() });
      return found;
    });
    onTestFinished(() => { pick.mockRestore(); });
    const before = await state(id);
    clients[0]!.client.send({ type: "deal" });
    const settled = await waitFor(id, (s) => s.handNumber === 2);
    expect(settled.replay).toBeDefined();
    expect(settled.connections[west.player]).not.toEqual(before.connections[west.player]);
  });
});
