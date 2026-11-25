import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import migration from "../migrations/0001_auth.sql?raw";
import charactersMigration from "../migrations/0005_bot_characters.sql?raw";
import worker from "./index.js";
import { AuthStore } from "./auth-store.js";

const origin = "https://bridge.example";
const settings = { ...env, AUTH_PUBLIC_ORIGIN: origin };
const store = new AuthStore(env.DB);
let cookie: string;
let playerId: string;
let accountId: string;
const call = (method = "GET", body?: unknown, headers = {}, path = "") => worker.fetch(new Request(`${origin}/api/account/characters${path}`, {
  method, headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json", "X-Expected-Player-ID": playerId, ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
}), settings);
const traits = { openings: "standard", competing: "standard", preempts: "standard", doubles: "cautious", leads: "standard", secondHand: "standard" };
const character = (id: string, updatedAt: number, extra = {}) => ({ id, name: "Gentle Gina", blurb: "Never doubles.", skill: "advanced", traits, updatedAt, ...extra });
const listed = async (response?: Response) => ((await (response ?? await call()).json()) as { characters: Array<Record<string, unknown>> }).characters;

beforeAll(async () => {
  for (const sql of [migration, charactersMigration]) await env.DB.exec(sql.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
});
beforeEach(async () => {
  await env.DB.batch(["bot_characters", "sessions", "accounts"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  const credential = "c".repeat(43);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential))), b => b.toString(16).padStart(2, "0")).join("");
  const account = await store.getOrCreateAccount("owner@example.com", "Owner", Date.now());
  accountId = account.id;
  playerId = account.primaryPlayerId;
  await env.DB.prepare("INSERT INTO sessions (session_hash, account_id, expires_at) VALUES (?, ?, ?)").bind(digest, account.id, Date.now() + 60_000).run();
  cookie = `__Host-contractplay_session=${credential}`;
});

describe("account characters", () => {
  it("stores and lists a player's characters in the order they were made", async () => {
    expect(await listed()).toEqual([]);
    expect(await listed(await call("POST", { characters: [character("own-bbbbbb", 2), character("own-aaaaaa", 1, { owner: "someone" })] })))
      .toEqual([character("own-bbbbbb", 2), character("own-aaaaaa", 1)]);
  });

  it("keeps the newer edit", async () => {
    await call("POST", { characters: [character("own-aaaaaa", 5, { name: "New" })] });
    await call("POST", { characters: [character("own-aaaaaa", 3, { name: "Old" })] });
    expect(await listed()).toEqual([character("own-aaaaaa", 5, { name: "New" })]);
  });

  it("stamps an edit from a clock running ahead no later than now", async () => {
    const future = Date.now() + 86_400_000;
    const [stored] = await listed(await call("POST", { characters: [character("own-aaaaaa", future)] }));
    expect(stored!.updatedAt).toBeLessThanOrEqual(Date.now());
    // So a later edit from a correct clock still wins.
    await call("POST", { characters: [character("own-aaaaaa", Date.now() + 1, { name: "Later" })] });
    expect((await listed())[0]!.name).toBe("Later");
  });

  it("keeps deletions", async () => {
    await call("POST", { characters: [character("own-aaaaaa", 1)] });
    await call("POST", { characters: [character("own-aaaaaa", 2, { deleted: true })] });
    expect(await listed()).toEqual([character("own-aaaaaa", 2, { deleted: true })]);
  });

  it("trims old deletions but never a live character", async () => {
    await call("POST", { characters: [character("own-live00", 1)] });
    await call("POST", { characters: Array.from({ length: 90 }, (_, i) => character(`own-d${String(i).padStart(5, "0")}`, 10 + i, { deleted: true })) });
    const characters = await listed();
    expect(characters.filter((entry) => entry.deleted)).toHaveLength(76);
    expect(characters.some((entry) => entry.id === "own-live00")).toBe(true);
  });

  it("rejects bad characters and too many", async () => {
    for (const bad of [character("own-aaaaaa", 1, { traits: { ...traits, leads: "wild" } }), character("tess", 1), character("own-aaaaaa", 1, { name: "" })]) {
      expect((await call("POST", { characters: [bad] })).status).toBe(400);
    }
    expect((await call("POST", {})).status).toBe(400);
    expect((await call("POST", { characters: Array.from({ length: 101 }, (_, i) => character(`own-x${String(i).padStart(5, "0")}`, 1, { deleted: true })) })).status).toBe(400);
    const many = Array.from({ length: 25 }, (_, i) => character(`own-x${String(i).padStart(5, "0")}`, 1));
    const refused = await call("POST", { characters: many });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "too-many-characters" });
    expect(await listed()).toEqual([]);
    expect((await call("POST", { characters: many.slice(0, 24) })).status).toBe(200);
  });

  it("holds the limit when requests race", async () => {
    const batch = (prefix: string) => Array.from({ length: 13 }, (_, i) => character(`own-${prefix}${String(i).padStart(5, "0")}`, 1));
    await Promise.all([call("POST", { characters: batch("a") }), call("POST", { characters: batch("b") }), call("POST", { characters: batch("c") })]);
    expect((await store.listCharacters(accountId)).filter((entry) => !entry.deleted).length).toBeLessThanOrEqual(24);
  });

  it("needs the signed-in player, and keeps accounts apart", async () => {
    expect((await call("GET", undefined, { Cookie: "" })).status).toBe(401);
    expect((await call("GET", undefined, { "X-Expected-Player-ID": "stale" })).status).toBe(409);
    expect((await call("POST", { characters: [] }, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await call("DELETE")).status).toBe(405);
    expect((await call("GET", undefined, {}, "/own-aaaaaa")).status).toBe(404);
    const other = await store.getOrCreateAccount("other@example.com", "Other", Date.now());
    await call("POST", { characters: [character("own-aaaaaa", 1)] });
    expect(await store.listCharacters(other.id)).toEqual([]);
    expect(await store.listCharacters(accountId)).toHaveLength(1);
  });
});
