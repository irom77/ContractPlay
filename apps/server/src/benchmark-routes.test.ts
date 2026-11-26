import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BOT_CHARACTERS } from "@contractplay/core";
import { createBenchmarkProfile, createRotation } from "@contractplay/benchmark";
import authMigration from "../migrations/0001_auth.sql?raw";
import migration from "../migrations/0006_bot_benchmarks.sql?raw";
import { hash } from "./auth.js";
import { AuthStore } from "./auth-store.js";
import worker from "./index.js";
import { BenchmarkStore } from "./benchmark-store.js";

const origin = "https://bridge.example";
const admin = "/api/admin/benchmarks";
const publicPath = "/api/benchmarks";
const auth = new AuthStore(env.DB);
const tokens = { admin: "a".repeat(43), member: "b".repeat(43) };
const cookie = (token: string) => `__Host-contractplay_session=${token}`;
const profile = { skill: "beginner", aggression: "conservative", biddingStyle: "SAYC", version: "v1", engineVersion: "build-1" };
const pbn = `[Event "Private tournament"]
[Board "8"]
[Dealer "W"]
[Vulnerable "None"]
[Deal "N:AKQJT98765432... .AKQJT98765432.. ..AKQJT98765432. ...AKQJT98765432"]
[North "Traveller Alice"]
[ScoreTable "PairId_NS;PairId_EW;Score_NS"]
11 22 880
[Auction "W"]
1C Pass Pass Pass
[Play "N"]
SA H2 D2 C2
*`;
let adminId: string;

function call(path: string, init: RequestInit = {}, allowlist: string | undefined = adminId): Promise<Response> {
  return worker.fetch(new Request(`${origin}${path}`, { ...init, headers: {
    Origin: origin, ...init.headers
  } }), { ...env, AUTH_PUBLIC_ORIGIN: origin, BENCHMARK_ADMIN_ACCOUNT_IDS: allowlist } as Env);
}

function write(path: string, body: unknown, method = "POST") {
  return call(`${admin}${path}`, { method, body: JSON.stringify(body), headers: { Cookie: cookie(tokens.admin) } });
}

function read(path: string) {
  return call(`${admin}${path}`, { headers: { Cookie: cookie(tokens.admin) } });
}

beforeAll(async () => {
  for (const sql of [authMigration, migration]) {
    await env.DB.exec(sql.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
  }
});

beforeEach(async () => {
  await env.DB.batch(["sessions", "account_player_identities", "accounts"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  await env.DB.batch(["benchmark_results", "benchmark_boards", "benchmark_table_assignments", "benchmark_jobs",
    "benchmark_cohorts", "benchmark_imports", "benchmark_profile_versions",
    "benchmark_profiles"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  const now = Date.now();
  const accounts = await Promise.all([auth.getOrCreateAccount("ops@example.test", "Ops", now),
    auth.getOrCreateAccount("member@example.test", "Member", now)]);
  adminId = accounts[0].id;
  await env.DB.batch(accounts.map((account, index) => env.DB.prepare("INSERT INTO sessions (session_hash, account_id, expires_at) VALUES (?, ?, ?)")
    .bind(index === 0 ? adminHash : memberHash, account.id, now + 60_000)));
});
const [adminHash, memberHash] = await Promise.all([hash(tokens.admin), hash(tokens.member)]);

describe("benchmark HTTP routes", () => {
  it("enforces the session account allowlist across every benchmark admin path", async () => {
    const spoof = { accountId: adminId, adminId, ...profile };
    expect((await call(`${admin}/profiles?accountId=${adminId}`, { method: "POST", body: JSON.stringify(spoof),
      headers: { "X-Account-Id": adminId } })).status).toBe(401);
    expect((await call(`${admin}/profiles`, { method: "POST", body: JSON.stringify(spoof),
      headers: { Cookie: cookie(tokens.member), "X-Account-Id": adminId } })).status).toBe(403);
    expect((await call(`${admin}/jobs/missing/pause`)).status).toBe(401);
    expect((await call(`${admin}/profiles`, { headers: { Cookie: cookie(tokens.admin) } }, "")).status).toBe(403);
    expect((await call(`${admin}/profiles`, { method: "POST", body: JSON.stringify(profile),
      headers: { Cookie: cookie(tokens.admin), Origin: "https://other.example" } })).status).toBe(401);
    expect((await write("/profiles", profile)).status).toBe(201);
    await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE session_hash = ?").bind(Date.now(), adminHash).run();
    expect((await read("/profiles")).status).toBe(401);
  });

  it("supports versioned roster, cohort edits and queued job lifecycle without exposing job data publicly", async () => {
    const chosen = BOT_CHARACTERS.slice(0, 4);
    for (const bot of chosen) {
      expect((await write("/profiles", { ...profile, skill: bot.skill, aggression: bot.aggression })).status).toBe(201);
    }
    expect((await write("/profiles", { ...profile, engineVersion: "overwrite" })).status).toBe(409);
    const members = chosen.map((bot) => ({ profileId: bot.id, version: "v1" }));
    const configuration = { name: "Rating pool", profiles: members, boardCount: 16, maxTables: 2,
      biddingStyle: "SAYC", scoring: "imps", rotationSeed: 7, intervalMinutes: 240 };
    expect((await write("/cohorts", { ...configuration, profiles: [...members.slice(1), members[1]] })).status).toBe(400);
    expect((await write("/cohorts", { ...configuration, maxTables: 9 })).status).toBe(400);
    for (const intervalMinutes of [1, 7]) {
      expect((await write("/cohorts", { ...configuration, intervalMinutes })).status).toBe(400);
    }
    const created = await write("/cohorts", { ...configuration, intervalMinutes: 5 });
    expect(created.status).toBe(201);
    const { id } = await created.json<{ id: string }>();
    const job = await write("/jobs", { id: "test-job", cohortId: id });
    expect(job.status).toBe(201);
    expect(await job.json()).toMatchObject({ id: "test-job", status: "queued", cohort: { name: "Rating pool", boardCount: 16 } });
    const concurrentStarts = await Promise.all([write("/jobs", { cohortId: id }), write("/jobs", { cohortId: id })]);
    expect(concurrentStarts.map((response) => response.status)).toEqual([201, 201]);
    const allocatedRounds = await Promise.all(concurrentStarts.map(async (response) => (await response.json<{ roundIndex: number }>()).roundIndex));
    expect(allocatedRounds).toEqual([1, 2]);
    const retryBody = { id: "retry-job", cohortId: id };
    const retry = await write("/jobs", retryBody);
    expect(retry.status).toBe(201);
    expect(await retry.json()).toMatchObject({ id: "retry-job", roundIndex: 3 });
    expect(await (await write("/jobs", retryBody)).json()).toMatchObject({ id: "retry-job", roundIndex: 3 });
    expect((await write("/jobs", { cohortId: id, roundIndex: 99 })).status).toBe(400);
    expect((await write(`/cohorts/${id}`, { ...configuration, boardCount: 1 }, "PUT")).status).toBe(200);
    expect((await write("/jobs/test-job/pause", {})).status).toBe(200);
    expect((await write("/jobs/test-job/resume", {})).status).toBe(200);
    expect((await write("/jobs/test-job/cancel", {})).status).toBe(200);
    expect((await write("/jobs/test-job/resume", {})).status).toBe(409);
    expect(await (await read("/jobs/test-job")).json()).toMatchObject({ status: "cancelled", cohort: { boardCount: 16 } });
    expect((await write(`/cohorts/${id}`, undefined, "DELETE")).status).toBe(204);
    expect((await write("/jobs", { cohortId: id })).status).toBe(409);
    expect((await write(`/profiles/${members[0]!.profileId}/v1`, undefined, "DELETE")).status).toBe(204);
    expect((await call(`${publicPath}/jobs/test-job`)).status).toBe(404);
    expect(await (await call(`${publicPath}/results`)).json()).toEqual({ results: [] });
    expect(await (await call(`${publicPath}/leaderboard`)).json()).toEqual({ ratings: [] });
    expect((await call(`${publicPath}/profiles?limit=100000`)).status).toBe(400);
    expect((await call(`${publicPath}/profiles?limit=1`)).status).toBe(200);
  });

  it("serves rolling public IMP and matchpoint profile diagnostics", async () => {
    await write("/profiles", profile);
    const response = await call(`${publicPath}/profiles/${BOT_CHARACTERS[0]!.id}/v1/metrics`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("keeps imported replays private publicly and retains them for authorized admin review after upload removal", async () => {
    const upload = await call(`${admin}/imports`, { method: "POST", body: pbn, headers: { Cookie: cookie(tokens.admin) } });
    expect(upload.status).toBe(201);
    const { id: importId } = await upload.json<{ id: string }>();
    const store = new BenchmarkStore(env.DB);
    const roster = BOT_CHARACTERS.slice(0, 4).map(({ skill, aggression }) =>
      createBenchmarkProfile({ ...profile, skill, aggression, biddingStyle: "SAYC" }));
    for (const entry of roster) await store.addProfileVersion(entry, 1);
    expect((await write("/cohorts", { name: "Wrong count", profiles: roster.map(({ profileId, version }) => ({ profileId, version })), boardCount: 2, maxTables: 2,
      biddingStyle: "SAYC", scoring: "imps", rotationSeed: 1, importId, intervalMinutes: null })).status).toBe(409);
    expect(await store.createCohort("private-cohort", { name: "Private boards", profiles: roster, boardCount: 1, maxTables: 2,
      biddingStyle: "SAYC", scoring: "imps", rotationSeed: 7, importId, intervalMinutes: null }, 2)).toBe(true);
    await store.startJob({ id: "imported-job", cohortId: "private-cohort", roundIndex: 0, now: 3 });
    const seats = createRotation(roster, 7, 0, 2)[0]!;
    const claim = { token: "worker", now: 4 };
    await store.claimNextJob(claim.token, claim.now, 10);
    await store.putTableAssignments("imported-job", [seats, seats], claim);
    await store.putJobBoards("imported-job", [], claim);
    expect(await store.startBoard("imported-job", 0, claim)).toBe(true);
    const actions = (["west", "north", "east", "south"] as const).map((seat) => ({ type: "bid", seat, bid: "pass" } as const));
    for (const tableIndex of [0, 1]) {
      expect(await store.recordResult({ jobId: "imported-job", tableIndex, boardIndex: 0, actions,
        contract: null, tricks: null, nsScore: 0, completedAt: 5 })).toBe(true);
    }

    const dd = "/jobs/imported-job/boards/0/double-dummy";
    expect((await read(dd)).status).toBe(404);
    expect(await store.finishJob("imported-job", claim.token, "completed", 7)).toBe(true);
    expect((await call(admin + dd)).status).toBe(401);
    expect((await call(admin + dd, { headers: { Cookie: cookie(tokens.member) } })).status).toBe(403);
    expect(await (await read(dd)).json()).toMatchObject({ analyzed: false, board: { number: 8, dealer: "west" } });
    const sample = { source: "bridge-dds-1.4.0", parNS: 420, tricks: Array.from({ length: 5 }, () => [7, 8, 9, 10]) };
    expect((await write(dd, { ...sample, tricks: [[14]] })).status).toBe(400);
    expect((await write(dd, sample)).status).toBe(201);
    expect((await write(dd, sample)).status).toBe(200);
    expect((await write(dd, { ...sample, parNS: 430 })).status).toBe(409);
    expect(await (await read(dd)).json()).toEqual({ analyzed: true });
    const metric = await call(`${publicPath}/profiles/${seats.north.profileId}/${seats.north.version}/diagnostics`);
    expect(await metric.json()).toEqual({ source: sample.source, maxTableResults: 128, analyzedTableResults: 2,
      auction: { samples: 2, meanAbsoluteParGapPoints: 420 }, declarer: { samples: 0, meanTricksBelowOptimum: null },
      defense: { samples: 0, meanTricksPreventedVsDoubleDummy: null } });

    const attempt = await call(`${publicPath}/results/imported-job/0/0`);
    expect(attempt.status).toBe(404);
    expect(await attempt.json()).toEqual({ error: "not-found" });
    expect(await store.getReleasedResult("imported-job", 0, 0)).toMatchObject({ board: { number: 8, dealer: "west" }, actions });
    const replayPath = `${admin}/jobs/imported-job/results/0/0`;
    expect((await call(replayPath)).status).toBe(401);
    expect((await call(replayPath, { headers: { Cookie: cookie(tokens.member) } })).status).toBe(403);
    await env.DB.prepare("DELETE FROM benchmark_imports WHERE id = ?").bind(importId).run();
    const adminReplay = await call(replayPath, { headers: { Cookie: cookie(tokens.admin) } });
    expect(adminReplay.status).toBe(200);
    expect(await adminReplay.json()).toMatchObject({ board: { number: 8, dealer: "west" }, actions });
    expect((await call(`${publicPath}/results/imported-job/0/0`)).status).toBe(404);
    const list = await call(`${publicPath}/results`);
    const { results } = await list.json<{ results: unknown[] }>();
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ jobId: "imported-job", tableIndex: 0, boardIndex: 0, boardNumber: 8,
      scoring: "imps", nsScore: 0, ewScore: 0, tricks: null, completedAt: 5, releasedAt: 5, replayAvailable: false, replayStatus: "private-import" });
  });

  it("atomically rejects invalid or oversized PBN and stores only validated board facts on retry", async () => {
    const upload = (body: string) => call(`${admin}/imports`, { method: "POST", body, headers: { Cookie: cookie(tokens.admin) } });
    expect((await upload(`${pbn}\n${pbn.replace('[Board "8"]', '[Board "9"]').replace("AKQJT98765432...", "KQJT98765432...")}`)).status).toBe(400);
    expect((await upload(`${pbn}\n${pbn}`)).status).toBe(400);
    expect((await upload(Array.from({ length: 33 }, (_, index) => pbn.replace('[Board "8"]', `[Board "${index + 1}"]`)).join("\n"))).status).toBe(400);
    expect((await upload("x".repeat(160_000))).status).toBe(413);
    expect(await (await read("/imports")).json()).toEqual({ imports: [] });
    const valid = await upload(pbn);
    expect(valid.status).toBe(201);
    const { id } = await valid.json<{ id: string }>();
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(await (await upload(pbn.replace("Traveller Alice", "Someone Else"))).json()).toMatchObject({ id });
    const stored = await env.DB.prepare("SELECT boards_json FROM benchmark_imports WHERE id = ?").bind(id).first<string>("boards_json");
    const facts = JSON.parse(stored!);
    expect(facts).toEqual([{ number: 8, dealer: "west", vulnerability: "None",
      deal: { north: expect.any(Array), east: expect.any(Array), south: expect.any(Array), west: expect.any(Array) } }]);
    expect((await call(`${publicPath}/imports/${id}`)).status).toBe(404);
  });
});
