import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeck, deal } from "@contractplay/core";
import type { Bid, GameAction, Seat } from "@contractplay/core";
import authMigration from "../migrations/0001_auth.sql?raw";
import rateMigration from "../migrations/0002_auth_rate_limits.sql?raw";
import archiveMigration from "../migrations/0003_deal_archive.sql?raw";
import worker from "./index.js";

const origin = "https://bridge.example";
const config = { ...env, AUTH_PUBLIC_ORIGIN: origin } as Env;
const sql = (text: string) => text.replace(/--[^\n]*/g, "").replace(/\n/g, " ");
const hands = deal(createDeck());
const order: Seat[] = ["north", "east", "south", "west"];
const bids = (...calls: Bid[]): GameAction[] => calls.map((bid, index) => ({ type: "bid", seat: order[index % 4]!, bid }));
const fourSpades: GameAction[] = [...bids("pass", "pass", "4spades", "pass", "pass", "pass"), { type: "claim", seat: "west", tricks: 3 }];
const hand = (overrides: Record<string, unknown> = {}) => ({ deal: hands, dealer: "north", vulnerability: "None", actions: fourSpades, ...overrides });
const call = (path: string, init: RequestInit = {}, ip = "192.0.2.1") => worker.fetch(new Request(`${origin}${path}`, {
  ...init, headers: { "CF-Connecting-IP": ip, ...(init.method === "POST" ? { Origin: origin } : {}), ...init.headers }
}), config);
const post = (body: unknown, ip?: string, headers: Record<string, string> = {}) =>
  call("/api/deals/results", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers }, ip);

beforeAll(async () => {
  for (const migration of [authMigration, rateMigration, archiveMigration]) await env.DB.exec(sql(migration));
});
beforeEach(async () => {
  await env.DB.batch(["deal_results", "archived_deals", "auth_rate_limits"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
});

describe("POST /api/deals/results", () => {
  it("stores a legal finished hand, which then replays once it is a day old", async () => {
    const response = await post(hand({ source: "online", playedAt: 1 }));
    expect(response.status).toBe(201);
    const { dealId } = await response.json() as { dealId: string };
    expect((await call("/api/deals/replay")).status).toBe(204);
    await env.DB.prepare("UPDATE archived_deals SET first_played_at = ?").bind(Date.now() - 25 * 3_600_000).run();
    const replay = await call("/api/deals/replay");
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ dealId, record: expect.any(Object) });
    const rows = (await env.DB.prepare("SELECT source, played_at FROM deal_results").all()).results as { source: string; played_at: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("solo");
    expect(rows[0]!.played_at).toBeGreaterThan(1_000_000);
  });

  it("never serves or adds to deals dealt at online tables", async () => {
    const { DealArchive } = await import("./deal-archive.js");
    const online = await new DealArchive(env.DB).record({ ...hand(), source: "online", playedAt: 0 } as never);
    expect((await call("/api/deals/replay")).status).toBe(204);
    expect((await post(hand({ replayOf: online }))).status).toBe(400);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM deal_results").first<{ n: number }>())!.n).toBe(1);
  });

  it("rejects malformed or illegal hands with 400", async () => {
    const short = { ...hands, north: hands.north.slice(1) };
    const duplicate = { ...hands, north: [hands.north[1]!, ...hands.north.slice(1)], east: [hands.north[1]!, ...hands.east.slice(1)] };
    const bodies: unknown[] = [hand({ deal: short }), hand({ deal: duplicate }), hand({ actions: fourSpades.slice(0, 3) }),
      hand({ dealer: "up" }), hand({ vulnerability: "Some" }), hand({ actions: "pass" }), hand({ actions: [{ type: "bid", seat: "north", bid: 5 }] }),
      hand({ replayOf: 7 }), hand({ replayOf: "no-such-deal" }), "{not json", "[]"];
    for (const body of bodies) expect((await post(body)).status).toBe(400);
    expect(await (await post(hand({ actions: [] }))).json()).toEqual({ error: "invalid-hand" });
  });

  it("rejects an oversized body", async () => {
    expect((await post(hand({ padding: "x".repeat(64_001) }))).status).toBe(400);
  });

  it("refuses a cross-origin request", async () => {
    expect((await post(hand(), undefined, { Origin: "https://evil.example" })).status).toBe(403);
  });

  it("limits each address to 120 posts an hour", async () => {
    for (let n = 0; n < 120; n++) expect((await post(hand())).status).toBe(201);
    const limited = await post(hand());
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "too-many-requests" });
    expect((await post(hand(), "192.0.2.9")).status).toBe(201);
  });

  it("answers 503 instead of throwing when the archive is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await env.DB.exec("ALTER TABLE deal_results RENAME TO deal_results_off");
    try {
      expect((await post(hand())).status).toBe(503);
    } finally {
      await env.DB.exec("ALTER TABLE deal_results_off RENAME TO deal_results");
    }
  });
});

describe("GET /api/deals/replay", () => {
  it("answers 204 for an empty archive", async () => {
    expect((await call("/api/deals/replay")).status).toBe(204);
  });

  it("rejects an unknown vulnerability filter", async () => {
    expect((await call("/api/deals/replay?vulnerability=Bogus")).status).toBe(400);
    expect((await call("/api/deals/replay?vulnerability=NS")).status).toBe(204);
  });

  it("limits each address to 60 requests an hour", async () => {
    for (let n = 0; n < 60; n++) expect((await call("/api/deals/replay")).status).toBe(204);
    expect((await call("/api/deals/replay")).status).toBe(429);
  });

  it("refuses a request from another origin", async () => {
    expect((await call("/api/deals/replay", { headers: { Origin: "https://evil.example" } })).status).toBe(403);
  });
});
