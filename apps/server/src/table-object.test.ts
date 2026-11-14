import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { PROTOCOL_VERSION } from "@contractplay/protocol";
import type { ServerMessage, TableView } from "@contractplay/protocol";
import type { TableState } from "@contractplay/table";
import migration from "../migrations/0001_auth.sql?raw";
import worker from "./index.js";
import { AuthStore } from "./auth-store.js";

const origin = "https://bridge.example";
const config = { ...env, AUTH_PUBLIC_ORIGIN: origin };
const store = new AuthStore(env.DB);
const secretA = "a".repeat(43);
const secretB = "b".repeat(43);
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, "0")).join("");
const stored = (id: string) => runInDurableObject(env.TABLES.get(env.TABLES.idFromName(id)), (_instance, state) => state.storage.get<TableState>("state"));

beforeAll(async () => { await env.DB.exec(migration.replace(/\n/g, " ")); });
beforeEach(async () => {
  await env.DB.batch(["sessions", "account_player_identities", "accounts"].map((name) => env.DB.prepare(`DELETE FROM ${name}`)));
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
  it("reloads the previous guest-only protocol before accepting an account identity", async () => {
    const id = await table();
    const auth = await account();
    const client = await socket(id, { Cookie: auth.cookie });
    client.send({ ...accountHello, version: 5 });
    expect(await client.next()).toEqual({ type: "reload" });
    expect((await stored(id))?.connections).toEqual({});
  });

  it("uses a new account's random stable primary player ID and verified name", async () => {
    const id = await table();
    const auth = await account();
    const client = await socket(id, { Cookie: auth.cookie });
    client.send(accountHello);
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
    client.send(accountHello);
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
    reconnected.send(accountHello);
    expect((await reconnected.view()).yourSeat).toBe("east");
    expect((await stored(id))?.connections[guestPlayer]).toBe(1);
  });

  it("uses the primary identity when none of the linked identities is seated", async () => {
    const id = await table();
    const auth = await account([await hash(secretA), await hash(secretB)]);
    const client = await socket(id, { Cookie: auth.cookie });
    client.send(accountHello);
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
    client.send(accountHello);
    expect(await client.next()).toEqual({ type: "identity-conflict" });
    expect(await stored(id)).toEqual(before);
  });

  it("ignores a guest secret in an authenticated hello", async () => {
    const id = await table();
    await seatGuest(id, secretB, "east");
    const auth = await account();
    const client = await socket(id, { Cookie: auth.cookie });
    client.send({ ...accountHello, secret: secretB });
    expect((await client.view()).yourSeat).toBeUndefined();
    expect((await stored(id))?.connections[auth.account.primaryPlayerId]).toBe(1);
  });

  it("strips forged public account headers and ignores account IDs in the URL", async () => {
    const id = await table();
    const auth = await account();
    const client = await socket(id, { "X-ContractPlay-Account": JSON.stringify({ id: auth.account.id, primaryPlayerId: auth.account.primaryPlayerId, displayName: "Account name" }) }, `?accountId=${auth.account.id}&playerId=${auth.account.primaryPlayerId}`);
    client.send(accountHello);
    expect(await client.next()).toMatchObject({ type: "refused", reason: "bad-message" });
    client.send({ ...accountHello, secret: secretA });
    await client.view();
    expect((await stored(id))?.connections).toEqual({ [await hash(secretA)]: 1 });
  });

  it("does not authenticate revoked or expired session cookies", async () => {
    for (const revoked of [true, false]) {
      const id = await table();
      const auth = await account();
      if (revoked) await store.revokeSession(auth.sessionHash, Date.now());
      else await env.DB.prepare("UPDATE sessions SET expires_at = 0 WHERE session_hash = ?").bind(auth.sessionHash).run();
      const client = await socket(id, { Cookie: auth.cookie });
      client.send(accountHello);
      expect(await client.next()).toMatchObject({ type: "refused", reason: "bad-message" });
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
