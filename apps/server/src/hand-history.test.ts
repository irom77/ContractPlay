import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAction, createDeck, createGameState, deal, type GameState } from "@contractplay/core";
import migration from "../migrations/0001_auth.sql?raw";
import worker from "./index.js";
import { AuthStore } from "./auth-store.js";

const origin = "https://bridge.example";
const settings = { ...env, AUTH_PUBLIC_ORIGIN: origin };
const store = new AuthStore(env.DB);
let cookie: string;
let accountId: string;
const call = (path = "", method = "GET", body?: unknown, headers = {}) => worker.fetch(new Request(`${origin}/api/account/online-hands${path}`, {
  method, headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json", ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
}), settings);
function hand(id = "online-ABC234-1", at = 1) {
  let game = createGameState({ deal: deal(createDeck()), dealer: "north", vulnerability: "None" });
  for (const action of [{ type: "bid", seat: "north", bid: "1notrump" }, { type: "bid", seat: "east", bid: "pass" }, { type: "bid", seat: "south", bid: "pass" }, { type: "bid", seat: "west", bid: "pass" }, { type: "claim", seat: "east", tricks: 0 }] as const) {
    const result = applyAction(game, action); if (!result.ok) throw new Error(result.error.message); game = result.state as GameState;
  }
  return { id, game, name: "My hand", savedAt: new Date(at).toISOString() };
}
const list = async () => (await (await call()).json()) as { hands: Array<ReturnType<typeof hand> & { onlineHistory: unknown }> };
beforeAll(async () => { await env.DB.exec(migration.replace(/\n/g, " ")); });
beforeEach(async () => {
  await env.DB.batch(["online_hands", "sessions", "magic_links", "account_player_identities", "accounts"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  const credential = "a".repeat(43);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential))), b => b.toString(16).padStart(2, "0")).join("");
  const account = await store.getOrCreateAccount("owner@example.com", "Owner", Date.now()); accountId = account.id;
  await env.DB.prepare("INSERT INTO sessions (session_hash, account_id, expires_at) VALUES (?, ?, ?)").bind(digest, account.id, Date.now() + 60_000).run();
  cookie = `__Host-contractplay_session=${credential}`;
});
describe("account online hand history", () => {
  it("requires a live session on all routes and prevents cross-origin writes", async () => {
    for (const [path, method, body] of [["", "GET", undefined], ["/import", "POST", { hands: [hand()] }], ["/online-ABC234-1", "PUT", { hand: hand() }]] as const) {
      expect((await call(path, method, body, { Cookie: "" })).status).toBe(401);
    }
    expect((await call("/import", "POST", { hands: [hand()] }, { Origin: "https://evil.example" })).status).toBe(403);
    await env.DB.prepare("UPDATE sessions SET expires_at = 0").run();
    expect((await call()).status).toBe(401);
  });
  it("takes ownership from the session and marks every browser upload as a noncompetitive archive", async () => {
    const other = await store.getOrCreateAccount("other@example.com", "Other", Date.now());
    expect((await call("/import", "POST", { accountId: other.id, hands: [{ ...hand(), onlineHistory: { source: "server", competitive: true } }] })).status).toBe(200);
    expect((await list()).hands[0]?.onlineHistory).toEqual({ source: "user-imported", competitive: false });
    expect(await store.listHands(other.id)).toEqual([]);
    expect(await store.listHands(accountId)).toHaveLength(1);
  });
  it("rejects malformed hands, wrong ids, excessive batches, and oversized serialized bodies", async () => {
    for (const invalid of [{}, { ...hand(), savedAt: "invalid" }, { ...hand(), id: "solo-1" }, { ...hand(), game: { ...hand().game, phase: "play" } }, { ...hand(), name: "x".repeat(70_000) }]) {
      expect((await call("/import", "POST", { hands: [invalid] })).status).toBe(400);
    }
    expect((await call("/online-ABC234-2", "PUT", { hand: hand() })).status).toBe(400);
    expect((await call("/import", "POST", { hands: Array.from({ length: 26 }, () => hand()) })).status).toBe(400);
    expect((await call("/import", "POST", { padding: "x".repeat(1_600_001), hands: [] })).status).toBe(413);
    expect((await list()).hands).toEqual([]);
  });
  it("keeps canonical records on duplicate imports and completed-hand retries", async () => {
    expect((await call("/online-ABC234-1", "PUT", { hand: hand() })).status).toBe(200);
    await call("/import", "POST", { hands: [{ ...hand(), name: "Replacement" }] });
    await call("/online-ABC234-1", "PUT", { hand: { ...hand(), name: "Retry" } });
    expect((await list()).hands).toHaveLength(1);
    expect((await list()).hands[0]?.name).toBe("My hand");
  });
  it("prunes to the 25 newest completion dates with stable id ordering", async () => {
    for (let i = 0; i < 27; i++) await call(`/online-ABC234-${i}`, "PUT", { hand: hand(`online-ABC234-${i}`, i) });
    const hands = (await list()).hands;
    expect(hands).toHaveLength(25); expect(hands[0]?.id).toBe("online-ABC234-26"); expect(hands.at(-1)?.id).toBe("online-ABC234-2");
  });
});
