import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import migration from "../migrations/0001_auth.sql?raw";
import botResultsMigration from "../migrations/0004_bot_results.sql?raw";
import worker from "./index.js";
import { AuthStore } from "./auth-store.js";

const origin = "https://bridge.example";
const settings = { ...env, AUTH_PUBLIC_ORIGIN: origin };
const store = new AuthStore(env.DB);
let cookie: string;
let playerId: string;
let accountId: string;
const call = (method = "GET", body?: unknown, headers = {}, path = "") => worker.fetch(new Request(`${origin}/api/account/bot-results${path}`, {
  method, headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json", "X-Expected-Player-ID": playerId, ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
}), settings);
const result = (handId: string, at?: number, extra = {}) => ({ handId, partner: "bea", left: "cora", right: "custom", score: 420, declared: true, made: true, ...(at === undefined ? {} : { at }), ...extra });
const listed = async (response?: Response) => ((await (response ?? await call()).json()) as { results: Array<{ handId: string }> }).results;

beforeAll(async () => {
  for (const sql of [migration, botResultsMigration]) await env.DB.exec(sql.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
});
beforeEach(async () => {
  await env.DB.batch(["bot_results", "sessions", "accounts"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  const credential = "b".repeat(43);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential))), b => b.toString(16).padStart(2, "0")).join("");
  const account = await store.getOrCreateAccount("owner@example.com", "Owner", Date.now());
  accountId = account.id;
  playerId = account.primaryPlayerId;
  await env.DB.prepare("INSERT INTO sessions (session_hash, account_id, expires_at) VALUES (?, ?, ?)").bind(digest, account.id, Date.now() + 60_000).run();
  cookie = `__Host-contractplay_session=${credential}`;
});

describe("account bot results", () => {
  it("keeps the player's results, replacing a hand finished again, and lists them oldest first", async () => {
    expect(await listed()).toEqual([]);
    expect(await listed(await call("POST", { results: [result("mf3k2x-ab12cd", 2), result("online-ABC234-1", 1, { online: true, partner: "human" })] }))).toEqual([
      result("online-ABC234-1", 1, { online: true, partner: "human" }), result("mf3k2x-ab12cd", 2)]);
    await call("POST", { results: [result("mf3k2x-ab12cd", 3, { score: -50, made: false })] });
    expect(await listed()).toEqual([result("online-ABC234-1", 1, { online: true, partner: "human" }), result("mf3k2x-ab12cd", 3, { score: -50, made: false })]);
  });

  it("drops the device's owner tag and refuses malformed results and oversized batches", async () => {
    await call("POST", { results: [result("h1", 1, { owner: "someone-else" })] });
    expect(await listed()).toEqual([result("h1", 1)]);
    for (const bad of [{ ...result("h2"), partner: "nobody" }, { ...result("h2"), score: 1.5 }, { ...result("h2"), made: true, declared: false }, { ...result("h2"), handId: "a b" }, { ...result("h2"), online: false }]) {
      expect((await call("POST", { results: [bad] })).status).toBe(400);
    }
    expect((await call("POST", { results: Array.from({ length: 501 }, (_, i) => result(`h${i}`)) })).status).toBe(400);
    expect((await call("POST", {})).status).toBe(400);
    expect(await listed()).toEqual([result("h1", 1)]);
  });

  it("keeps the newest 2000", async () => {
    for (let batch = 0; batch < 5; batch += 1) {
      await call("POST", { results: Array.from({ length: 401 }, (_, i) => result(`h${batch}-${i}`, batch * 1000 + i)) });
    }
    const results = await listed();
    expect(results).toHaveLength(2000);
    expect(results[0]?.handId).toBe("h0-5");
  });

  it("needs a session, the same origin and the expected player, and keeps accounts apart", async () => {
    expect((await call("GET", undefined, { Cookie: "" })).status).toBe(401);
    expect((await call("POST", { results: [result("h1")] }, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await call("GET", undefined, { "X-Expected-Player-ID": "stale" })).status).toBe(409);
    expect((await call("PUT", { results: [] })).status).toBe(405);
    expect((await call("GET", undefined, {}, "/h1")).status).toBe(404);
    const other = await store.getOrCreateAccount("other@example.com", "Other", Date.now());
    await call("POST", { results: [result("h1")] });
    expect(await store.listBotResults(other.id)).toEqual([]);
    expect(await store.listBotResults(accountId)).toHaveLength(1);
  });
});
