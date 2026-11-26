import { env, evictDurableObject, runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, beforeAll, expect, it, onTestFinished, vi } from "vitest";
import { BOT_CHARACTERS } from "@contractplay/core";
import { createBenchmarkProfile, createRotation } from "@contractplay/benchmark";
import type { TableState } from "@contractplay/table";
import migration from "../migrations/0006_bot_benchmarks.sql?raw";
import { BenchmarkStore } from "./benchmark-store.js";
import { generatedSessionBoards, lobbyOf } from "./lobby-object.js";

const store = new BenchmarkStore(env.DB);
const coordinator = () => env.BENCHMARKS.get(env.BENCHMARKS.idFromName("benchmarks"));
const tick = () => runDurableObjectAlarm(coordinator());
const table = (id: string) => env.TABLES.get(env.TABLES.idFromName(id));
const stateOf = (id: string) => runInDurableObject(table(id), (_, ctx) => ctx.storage.get<TableState>("state"));

beforeAll(async () => {
  await env.DB.exec(migration.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
});
afterEach(() => vi.useRealTimers());

async function configure(id: string, engineVersion = "contractplay-bots-v1", intervalMinutes: number | null = null) {
  const profiles = BOT_CHARACTERS.slice(0, 4).map(({ skill, aggression }) => createBenchmarkProfile({
    skill, aggression, biddingStyle: "SAYC", version: engineVersion, engineVersion
  }));
  for (const profile of profiles) await store.addProfileVersion(profile, 1);
  expect(await store.createCohort(id, { name: id, profiles, boardCount: 2, maxTables: 2, biddingStyle: "SAYC",
    scoring: "imps", rotationSeed: 19, importId: null, intervalMinutes }, 1)).toBe(true);
}

it("runs one unit per alarm, resumes a partial setup, gates paused boards and retains replay after cleanup", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Keep runtime timers ahead of the wall clock so only the explicit test alarm deliveries run.
  vi.setSystemTime(Date.now() + 86_400_000);
  const id = "bounded";
  await configure(id);
  await coordinator().enqueue({ id, cohortId: id, roundIndex: 2 });
  let previous = 0;
  for (let step = 0; step < 24; step++) {
    const cursor = await runInDurableObject(coordinator(), (_, ctx) => ctx.storage.get("run:" + id));
    expect(await tick()).toBe(true);
    const listed = await lobbyOf(env).list();
    expect(listed.every((entry) => entry.benchmark && entry.id.length === 6)).toBe(true);
    expect(listed.length - previous).toBeLessThanOrEqual(1);
    if (listed.length === 1 && previous === 0) {
      // Simulate loss of the coordinator checkpoint after the lobby committed the first table.
      await runInDurableObject(coordinator(), (_, ctx) => ctx.storage.put("run:" + id, cursor));
      await evictDurableObject(coordinator());
    }
    previous = listed.length;
    if (listed.length === 2 && (await stateOf(listed[1]!.id))?.handNumber === 1 && (await stateOf(listed[0]!.id))?.handNumber === 1) break;
  }
  const listed = await lobbyOf(env).list();
  expect(listed).toHaveLength(2);
  const states = await Promise.all(listed.map(({ id }) => stateOf(id)));
  const [first, second] = states as TableState[];
  expect(first!.game?.initialDeal).toBeDefined();
  expect(first!.game?.initialDeal).toEqual(second!.game?.initialDeal);
  expect(Object.values(first!.seats).every((seat) => seat.kind === "bot")).toBe(true);
  expect(first!.seats.north).not.toEqual(second!.seats.north);
  expect(await store.listTableAssignments(id)).toHaveLength(2);
  const session = env.SESSIONS.get(env.SESSIONS.idFromName(first!.sessionId!));
  await coordinator().pause(id);
  const play = async (handNumber: number) => {
    for (let i = 0; i < 120; i++) {
      vi.setSystemTime(Date.now() + 4_000);
      for (const { id } of listed) {
        const prior = (await stateOf(id))!;
        if (!prior.game || prior.game.phase === "complete" || prior.game.phase === "passed-out") continue;
        expect(await runDurableObjectAlarm(table(id))).toBe(true);
        expect((await stateOf(id))!.game!.history.cursor).toBe(prior.game.history.cursor + 1);
      }
      if ((await session.status(first!.id))!.completedBoards === handNumber) return;
    }
    throw new Error("Tables did not finish");
  };
  await play(1);
  expect(await session.boardFor(first!.id, 1)).toBeUndefined();
  expect(await table(first!.id).startBenchmarkBoard(1)).toBe(false);
  expect(await store.getPublicResult(id, 0, 0)).toMatchObject({ boardIndex: 0, jobId: id });
  await coordinator().resume(id);
  for (let i = 0; i < 20 && (await Promise.all(listed.map(({ id }) => stateOf(id)))).some((s) => s?.handNumber !== 2); i++) await tick();
  expect((await stateOf(first!.id))!.handNumber).toBe(2);
  await play(2);
  for (let i = 0; i < 15 && ((await store.getJob(id))?.status !== "completed" || (await lobbyOf(env).list()).length); i++) await tick();
  expect((await store.getJob(id))?.status).toBe("completed");
  expect(await lobbyOf(env).list()).toEqual([]);
  expect(await store.getPublicResult(id, 1, 1)).toMatchObject({ boardIndex: 1, jobId: id });
}, 60_000);

it("rejects an unavailable engine before creating tables", async () => {
  await configure("obsolete", "unavailable-engine");
  await coordinator().enqueue({ id: "unsupported", cohortId: "obsolete", roundIndex: 0 });
  for (let i = 0; i < 8 && (await store.getJob("unsupported"))?.status !== "failed"; i++) await tick();
  expect((await store.getJob("unsupported"))?.status).toBe("failed");
  expect(await lobbyOf(env).list()).toEqual([]);
});

it("rolls back partial setup when the lobby reaches capacity", async () => {
  await configure("capacity");
  const originalLimit = await runInDurableObject(lobbyOf(env), (instance) => {
    const limit = instance.limits.listed;
    instance.limits.listed = 1;
    return limit;
  });
  onTestFinished(async () => { await runInDurableObject(lobbyOf(env), (instance) => { instance.limits.listed = originalLimit; }); });
  await coordinator().enqueue({ id: "capacity-test", cohortId: "capacity", roundIndex: 0 });
  for (let i = 0; i < 20 && ((await store.getJob("capacity-test"))?.status !== "failed" || (await lobbyOf(env).list()).length); i++) await tick();
  expect((await store.getJob("capacity-test"))?.status).toBe("failed");
  expect(await lobbyOf(env).list()).toEqual([]);
});

it("enqueues scheduled cohorts once per cadence and cancels partial setup", async () => {
  await configure("cadence", undefined, 60);
  const now = Date.now();
  await coordinator().enqueueDue(now);
  await coordinator().enqueueDue(now);
  const jobs = (await store.listJobs()).filter((j) => j.cohortId === "cadence");
  expect(jobs).toHaveLength(1);
  const job = jobs[0]!;
  for (let i = 0; i < 12 && !(await lobbyOf(env).list()).length; i++) await tick();
  expect(await lobbyOf(env).list()).toHaveLength(1);
  await coordinator().cancel(job.id);
  for (let i = 0; i < 12 && (await lobbyOf(env).list()).length; i++) await tick();
  expect(await lobbyOf(env).list()).toEqual([]);
  await coordinator().enqueueDue(now + 3_599_999);
  expect((await store.listJobs()).filter((j) => j.cohortId === "cadence")).toHaveLength(1);
  await coordinator().enqueueDue(now + 3_600_000);
  const scheduled = (await store.listJobs()).filter((j) => j.cohortId === "cadence");
  expect(scheduled.map((j) => j.roundIndex)).toEqual([1, 0]);
  await coordinator().cancel(scheduled[0]!.id);
});

it("rearms a stranded table without playing its turn in the coordinator", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Keep runtime timers ahead of the wall clock so only the explicit test alarm deliveries run.
  vi.setSystemTime(Date.now() + 86_400_000);
  await configure("stranded");
  await coordinator().enqueue({ id: "stranded", cohortId: "stranded", roundIndex: 0 });
  for (let i = 0; i < 20; i++) {
    await tick();
    const tables = await lobbyOf(env).list();
    if (tables.length === 2 && (await Promise.all(tables.map(({ id }) => stateOf(id)))).every((state) => state?.handNumber === 1)) break;
  }
  const [first] = await lobbyOf(env).list();
  const stub = table(first!.id);
  await runInDurableObject(stub, (_, ctx) => ctx.storage.deleteAlarm());
  for (let i = 0; i < 4; i++) {
    vi.setSystemTime(Date.now() + 15_000);
    await tick();
  }
  expect(await runInDurableObject(stub, (_, ctx) => ctx.storage.getAlarm())).not.toBeNull();
  expect((await stateOf(first!.id))!.game!.history.cursor).toBe(0);
  vi.setSystemTime(Date.now() + 60 * 60_000);
  for (let i = 0; i < 8 && (await store.getJob("stranded"))?.status !== "failed"; i++) await tick();
  expect((await store.getJob("stranded"))?.status).toBe("failed");
});

it("releases a failed reservation without deleting a different table already using the ID", async () => {
  const lobby = lobbyOf(env);
  const id = "ABCDEF";
  const foreign = table(id);
  await foreign.create({ id, name: "Existing table", listed: true, style: "SAYC" });
  await runInDurableObject(lobby, (_, ctx) => ctx.storage.put({
    "benchmark:collision:0": id, ["listed:" + id]: { listed: true }
  }));
  await lobby.releaseBenchmarkTable("collision", 0);
  expect((await stateOf(id))?.name).toBe("Existing table");
  expect(await lobby.list()).toContainEqual(expect.objectContaining({ id, name: "Existing table" }));
  expect(await runInDurableObject(lobby, (_, ctx) => ctx.storage.get("benchmark:collision:0"))).toBeUndefined();
});

it("backs off a failing cleanup while advancing a different benchmark job", async () => {
  await configure("cleanup-blocker");
  await configure("cleanup-healthy");
  await coordinator().enqueue({ id: "cleanup-blocker", cohortId: "cleanup-blocker", roundIndex: 0 });
  for (let i = 0; i < 8 && !(await lobbyOf(env).list()).length; i++) await tick();
  await coordinator().cancel("cleanup-blocker");
  await runInDurableObject(coordinator(), async (_, ctx) => {
    const cleanup = await ctx.storage.get<{ id: string; nextTable: number; count: number; nextAt: number; retries: number }>("cleanup:cleanup-blocker");
    if (cleanup) await ctx.storage.put("cleanup:cleanup-blocker", { ...cleanup, nextAt: Date.now() + 60_000, retries: 1 });
  });
  await coordinator().enqueue({ id: "cleanup-healthy", cohortId: "cleanup-healthy", roundIndex: 0 });
  await tick();
  expect((await store.getJob("cleanup-healthy"))?.status).toBe("running");
  expect(await runInDurableObject(coordinator(), (_, ctx) => ctx.storage.get("run:cleanup-healthy")))
    .toMatchObject({ phase: "boards" });
  const pending = await runInDurableObject(coordinator(), (_, ctx) => ctx.storage.get<{ nextAt: number; retries: number }>("cleanup:cleanup-blocker"));
  expect(pending?.retries).toBe(1);
  expect(pending?.nextAt).toBeGreaterThan(Date.now());
});

it("scans beyond a full page of delayed cleanups while idle", async () => {
  await runInDurableObject(coordinator(), async (_, ctx) => {
    const delayed = Object.fromEntries(Array.from({ length: 100 }, (_, i) => {
      const id = `delayed-${String(i).padStart(3, "0")}`;
      return [`cleanup:${id}`, { id, nextTable: 0, count: 0, nextAt: Date.now() + 300_000, retries: 1 }];
    }));
    await ctx.storage.put({ ...delayed, "cleanup:ready": { id: "ready", nextTable: 0, count: 0, nextAt: Date.now(), retries: 0 } });
    await ctx.storage.setAlarm(Date.now() + 1_000);
  });
  await tick();
  const nextAlarm = await runInDurableObject(coordinator(), (_, ctx) => ctx.storage.getAlarm());
  expect(nextAlarm).not.toBeNull();
  expect(nextAlarm).toBeLessThanOrEqual(Date.now() + 16_000);
  expect(await runInDurableObject(coordinator(), (_, ctx) => ctx.storage.get("cleanup:ready"))).toBeDefined();
  await tick();
  expect(await runInDurableObject(coordinator(), (_, ctx) => ctx.storage.get("cleanup:ready"))).toBeUndefined();
});

it("repairs a stale lobby summary when board publication is retried", async () => {
  const id = `publication-${crypto.randomUUID()}`;
  await configure(id);
  const cohort = (await store.getCohort(id))!;
  const now = Date.now();
  expect(await store.startJob({ id, cohortId: id, roundIndex: 0, now })).toBeDefined();
  const token = crypto.randomUUID();
  await env.DB.prepare("UPDATE benchmark_jobs SET status = 'running', claim_token = ?, claim_expires_at = ?, updated_at = ? WHERE id = ?")
    .bind(token, now + 90_000, now, id).run();
  const claim = { token, now };
  const boards = generatedSessionBoards(cohort.boardCount);
  await store.putJobBoards(id, boards, claim);
  const profiles = await Promise.all(cohort.profiles.map(async (key) => (await store.getProfile(key))!.profile));
  const rotation = [...createRotation(profiles, cohort.rotationSeed, 0, cohort.maxTables)];
  if (rotation.length === 1) {
    const { north, east, south, west } = rotation[0]!;
    rotation.push({ north: east, east: south, south: west, west: north });
  }
  await store.putTableAssignments(id, rotation, claim);
  const sessionId = `benchmark:${id}`;
  const lobby = lobbyOf(env);
  const tableIds = [];
  for (let index = 0; index < 2; index++) {
    const tableId = await lobby.createBenchmarkTable({ jobId: id, tableIndex: index, sessionId,
      name: `Publication ${index + 1}`, style: cohort.biddingStyle, assignment: rotation[index]! });
    expect(tableId).toBeTruthy();
    tableIds.push(tableId!);
  }
  const session = env.SESSIONS.get(env.SESSIONS.idFromName(sessionId));
  expect(await session.create({ id: sessionId, tables: tableIds, boards, scoring: cohort.scoring, benchmarkJobId: id })).toBe(true);
  expect(await store.startBoard(id, 0, claim)).toBe(true);
  onTestFinished(async () => {
    await lobby.releaseBenchmarkTable(id, 0);
    await lobby.releaseBenchmarkTable(id, 1);
    await session.deleteForRollback();
  });
  const targetId = tableIds[0]!;
  expect(await table(targetId).startBenchmarkBoard(0)).toBe(true);
  expect((await stateOf(targetId))?.handNumber).toBe(1);
  await runInDurableObject(table(targetId), (_, ctx) => ctx.storage.delete("benchmark:publishedLobby"));
  await runInDurableObject(lobbyOf(env), async (_, ctx) => {
    const entry = await ctx.storage.get<{ listed: boolean; summary?: { handInProgress: boolean } }>("listed:" + targetId);
    expect(entry?.summary?.handInProgress).toBe(true);
    await ctx.storage.put("listed:" + targetId, { ...entry!, summary: { ...entry!.summary!, handInProgress: false } });
  });
  expect((await lobby.list()).find(({ id }) => id === targetId)?.handInProgress).toBe(false);
  expect(await table(targetId).startBenchmarkBoard(0)).toBe(true);
  expect((await stateOf(targetId))?.handNumber).toBe(1);
  expect((await lobby.list()).find(({ id }) => id === targetId)?.handInProgress).toBe(true);
});
