import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { benchmarkProfileVersionId, createBenchmarkProfile, createRotation, GLICKO_2_VERSION } from "@contractplay/benchmark";
import type { RatingPeriodResult } from "@contractplay/benchmark";
import { createDeck, deal } from "@contractplay/core";
import migration from "../migrations/0006_bot_benchmarks.sql?raw";
import { BenchmarkStore, MAX_BENCHMARK_PAGE, type BenchmarkCohortInput } from "./benchmark-store.js";

const store = new BenchmarkStore(env.DB);
const profiles = (["beginner", "intermediate", "advanced", "expert"] as const).map((skill) =>
  createBenchmarkProfile({ skill, aggression: "normal", biddingStyle: "SAYC", version: "v1", engineVersion: "build-1" }));
const [first] = profiles;
const cohort: BenchmarkCohortInput = {
  name: "Built-ins", profiles, boardCount: 1, maxTables: 2, biddingStyle: "SAYC", scoring: "imps", rotationSeed: 17, importId: null,
  intervalMinutes: null
};
const board = { number: 1, deal: deal(createDeck()), dealer: "north", vulnerability: "None" } as const;
const actions = (["north", "east", "south", "west"] as const).map((seat) => ({ type: "bid", seat, bid: "pass" } as const));

beforeAll(async () => {
  await env.DB.exec(migration.replace(/--[^\n]*/g, "").replace(/\n/g, " "));
});

beforeEach(async () => {
  await env.DB.batch(["benchmark_rating_snapshots", "benchmark_rating_periods", "benchmark_results", "benchmark_boards",
    "benchmark_table_assignments", "benchmark_jobs", "benchmark_cohorts", "benchmark_imports", "benchmark_profile_versions",
    "benchmark_profiles"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
});

async function queue(id = "job", boardCount = 1) {
  for (const profile of profiles) await store.addProfileVersion(profile, 1);
  expect(await store.createCohort("cohort", { ...cohort, boardCount }, 2)).toBe(true);
  return store.startJob({ id, cohortId: "cohort", roundIndex: 0, now: 3 });
}

async function finish(id: string, now = 4) {
  const assignment = createRotation(profiles, 17, 0, 2)[0]!;
  const claim = { token: "worker", now };
  expect((await store.claimNextJob(claim.token, now, 10))?.id).toBe(id);
  await store.putTableAssignments(id, [assignment, assignment], claim);
  await store.putJobBoards(id, [board], claim);
  expect(await store.startBoard(id, 0, claim)).toBe(true);
  for (const tableIndex of [0, 1]) await store.recordResult({ jobId: id, tableIndex, boardIndex: 0, actions,
    contract: null, tricks: null, nsScore: 0, completedAt: now + 1 });
  expect(await store.finishJob(id, claim.token, "completed", now + 2)).toBe(true);
}

describe("BenchmarkStore", () => {
  it("gives changed strategies distinct version identities and cannot rewrite or reactivate an old version", async () => {
    const original = first!;
    expect(await store.addProfileVersion(original, 1)).toBe("created");
    expect(await store.addProfileVersion({ ...original, engineVersion: "build-2" }, 2)).toBe("conflict");
    expect(await store.retireProfileVersion(original, 3)).toBe(true);
    expect(await store.addProfileVersion(original, 4)).toBe("existing");
    expect(await store.addProfileVersion({ ...original, version: "v2", engineVersion: "build-2" }, 5)).toBe("created");
    expect(await store.listProfiles()).toEqual([
      { profile: { ...original, version: "v2", engineVersion: "build-2" }, status: "active", createdAt: 5, retiredAt: null },
      { profile: original, status: "retired", createdAt: 1, retiredAt: 3 }
    ]);
  });

  it("snapshots the cohort on queue and refuses to start a new job using a retired version", async () => {
    const job = await queue();
    expect(job).toMatchObject({ id: "job", schemaVersion: 1, rotationVersion: "round-robin-v1",
      profiles, cohort: { name: "Built-ins", boardCount: 1, rotationSeed: 17 } });
    expect(await store.updateCohort("cohort", { ...cohort, name: "Updated", boardCount: 2 }, 4)).toBe(true);
    await store.retireProfileVersion(first!, 5);
    expect(await store.startJob({ id: "next", cohortId: "cohort", roundIndex: 0, now: 6 })).toBeNull();
    expect(await store.startJob({ id: "job", cohortId: "cohort", roundIndex: 0, now: 7 })).toEqual(job);
  });

  it("atomically claims a job and fences off an expired or paused claim", async () => {
    await queue();
    const claims = await Promise.all([store.claimNextJob("first", 4, 10), store.claimNextJob("second", 4, 10)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await store.claimNextJob("third", 13, 10)).toBeNull();
    expect(await store.claimNextJob("third", 14, 10)).toMatchObject({ id: "job", status: "running" });
    expect(await store.finishJob("job", "first", "failed", 15)).toBe(false);
    expect(await store.changeJobStatus("job", "pause", 15)).toMatchObject({ status: "paused" });
    expect(await store.finishJob("job", "third", "failed", 16)).toBe(false);
    expect(await store.changeJobStatus("job", "resume", 17)).toMatchObject({ status: "queued" });
    expect(await store.changeJobStatus("job", "cancel", 18)).toMatchObject({ status: "cancelled" });
    expect(await store.claimNextJob("fourth", 19, 10)).toBeNull();
  });

  it("fences job setup against an expired, paused, or replaced claim", async () => {
    await queue();
    const assignment = createRotation(profiles, 17, 0, 2)[0]!;
    const setups = async (token: string, now: number) => {
      await store.putTableAssignments("job", [assignment, assignment], { token, now });
      await store.putJobBoards("job", [board], { token, now });
    };
    await store.claimNextJob("expired", 4, 10);
    await setups("expired", 14);
    expect(await store.listTableAssignments("job")).toEqual([]);
    expect(await store.listJobBoards("job")).toEqual([]);

    await store.claimNextJob("paused", 15, 10);
    await store.changeJobStatus("job", "pause", 16);
    await setups("paused", 17);
    expect(await store.listTableAssignments("job")).toEqual([]);
    expect(await store.listJobBoards("job")).toEqual([]);

    await store.changeJobStatus("job", "resume", 18);
    await store.claimNextJob("current", 19, 10);
    await setups("paused", 20);
    expect(await store.listTableAssignments("job")).toEqual([]);
    expect(await store.listJobBoards("job")).toEqual([]);

    await setups("current", 21);
    expect(await store.listTableAssignments("job")).toEqual([assignment, assignment]);
    expect(await store.listJobBoards("job")).toEqual([board]);
  });

  it("accepts late results for a board already in play while pause closes admission to later boards", async () => {
    await queue("job", 2);
    const assignment = createRotation(profiles, 17, 0, 2)[0]!;
    await store.claimNextJob("before-pause", 4, 20);
    const initial = { token: "before-pause", now: 5 };
    await store.putTableAssignments("job", [assignment, assignment], initial);
    await store.putJobBoards("job", [board, { ...board, number: 2 }], initial);
    const result = { jobId: "job", tableIndex: 0, boardIndex: 0, actions, contract: null, tricks: null, nsScore: 0, completedAt: 7 };
    expect(await store.recordResult(result)).toBe(false);
    expect(await store.startBoard("job", 1, initial)).toBe(false);
    expect(await store.startBoard("job", 0, initial)).toBe(true);
    expect(await store.recordResult(result)).toBe(true);
    await store.changeJobStatus("job", "pause", 8);
    expect(await store.recordResult({ ...result, tableIndex: 1, completedAt: 9 })).toBe(true);
    expect(await store.getPublicResult("job", 0, 0)).toBeNull();
    expect(await store.startBoard("job", 1, { ...initial, now: 10 })).toBe(false);
    expect(await store.recordResult({ ...result, boardIndex: 1, completedAt: 11 })).toBe(false);

    await store.changeJobStatus("job", "resume", 12);
    await store.claimNextJob("resumed", 13, 20);
    expect(await store.startBoard("job", 1, { ...initial, now: 14 })).toBe(false);
    const renewed = { token: "resumed", now: 15 };
    expect(await store.startBoard("job", 1, renewed)).toBe(true);
    expect(await store.startBoard("job", 1, renewed)).toBe(true);
    expect(await store.recordResult({ ...result, boardIndex: 1, completedAt: 16 })).toBe(true);
    expect(await store.recordResult({ ...result, tableIndex: 1, boardIndex: 1, completedAt: 17 })).toBe(true);
    expect(await store.finishJob("job", renewed.token, "completed", 18)).toBe(true);
    expect(await store.getPublicResult("job", 0, 0)).toMatchObject({ board, releasedAt: 9, scoring: "imps" });
  });

  it("releases a board once every duplicate table finishes it and keeps future boards private", async () => {
    await queue("job", 2);
    const assignment = createRotation(profiles, 17, 0, 2)[0]!;
    const claim = { token: "worker", now: 4 };
    await store.claimNextJob(claim.token, claim.now, 10);
    await store.putTableAssignments("job", [assignment, assignment], claim);
    await store.putJobBoards("job", [board, { ...board, number: 2 }], claim);
    expect(await store.startBoard("job", 0, claim)).toBe(true);
    const result = { jobId: "job", tableIndex: 0, boardIndex: 0, actions, contract: null, tricks: null, nsScore: 0, completedAt: 5 };
    expect(await store.recordResult(result)).toBe(true);
    expect(await store.recordResult({ ...result, nsScore: 100 })).toBe(false);
    expect(await store.getPublicResult("job", 0, 0)).toBeNull();
    expect(await store.listPublicResults()).toEqual([]);
    expect(await store.finishJob("job", "worker", "completed", 7)).toBe(false);
    expect(await store.recordResult({ ...result, tableIndex: 1 })).toBe(true);
    expect(await store.finishJob("job", "worker", "completed", 8)).toBe(false);
    expect(await store.getPublicResult("job", 0, 1)).toBeNull();
    expect(await store.getPublicResult("job", 0, 0)).toBeNull();
    expect(await store.listPublicResults()).toEqual([]);
    expect(await store.startBoard("job", 1, claim)).toBe(true);
    for (const tableIndex of [0, 1]) await store.recordResult({ ...result, tableIndex, boardIndex: 1, completedAt: 9 });
    expect(await store.finishJob("job", "worker", "completed", 10)).toBe(true);
    expect(await store.getPublicResult("job", 0, 0)).toMatchObject({ board, assignment, actions, nsScore: 0,
      scoring: "imps",
      field: [{ tableIndex: 0, nsScore: 0, contract: null, tricks: null }, { tableIndex: 1, nsScore: 0, contract: null, tricks: null }] });
    expect(await store.listPublicResults()).toHaveLength(4);
  });

  it("does not make a released board public when its whole job fails", async () => {
    await queue("failed", 1);
    const assignment = createRotation(profiles, 17, 0, 2)[0]!;
    const claim = { token: "worker", now: 4 };
    await store.claimNextJob(claim.token, claim.now, 10);
    await store.putTableAssignments("failed", [assignment, assignment], claim);
    await store.putJobBoards("failed", [board], claim);
    expect(await store.startBoard("failed", 0, claim)).toBe(true);
    for (const tableIndex of [0, 1]) await store.recordResult({ jobId: "failed", tableIndex, boardIndex: 0, actions,
      contract: null, tricks: null, nsScore: 0, completedAt: 5 });
    expect(await store.finishJob("failed", claim.token, "failed", 6)).toBe(true);
    expect(await store.getPublicResult("failed", 0, 0)).toBeNull();
    expect(await store.listPublicResults()).toEqual([]);
  });

  it("commits a rating period once and reads the latest comparable ratings without losing history", async () => {
    await queue();
    await finish("job");
    const competitorId = benchmarkProfileVersionId(first!);
    const observation = { competitorId, opponentId: benchmarkProfileVersionId(profiles[1]!),
      sampleBoards: 20, rawScore: { crossImps: 8, matchpoints: { points: 20, top: 40 } }, fractionalScore: 0.6 };
    const period: RatingPeriodResult = { algorithmVersion: GLICKO_2_VERSION, scoreTransformVersion: "fixture-v1",
      ratings: [{ competitorId, rating: 1550, deviation: 90, volatility: 0.06, sampleBoards: 20, eligible: true }], observations: [observation] };
    const amended: RatingPeriodResult = { ...period, ratings: [{ ...period.ratings[0]!, rating: 1600 }] };
    await expect(store.commitRatingPeriod("job", period, 10)).resolves.toMatchObject({ result: period, ratedAt: 10 });
    await expect(store.commitRatingPeriod("job", amended, 11)).resolves.toMatchObject({ result: period, ratedAt: 10 });
    await store.startJob({ id: "next", cohortId: "cohort", roundIndex: 1, now: 12 });
    await finish("next", 13);
    await store.commitRatingPeriod("next", amended, 20);
    expect(await store.listRatingHistory(competitorId)).toMatchObject([{ jobId: "next", rating: 1600 }, { jobId: "job", rating: 1550 }]);
    expect(await store.listLeaderboard()).toMatchObject([{ jobId: "next", rating: 1600, eligible: true }]);
  });

  it("takes boards for an imported job from its immutable source snapshot", async () => {
    for (const profile of profiles) await store.addProfileVersion(profile, 1);
    const source = { ...board, number: 18 };
    await store.putImport("source", [source], 2);
    expect(await store.createCohort("cohort", { ...cohort, importId: "source" }, 3)).toBe(true);
    expect(await store.startJob({ id: "job", cohortId: "cohort", roundIndex: 0, now: 4 })).not.toBeNull();
    const claim = { token: "worker", now: 5 };
    await store.claimNextJob(claim.token, claim.now, 10);
    await store.putJobBoards("job", [board], claim);
    expect(await store.listJobBoards("job")).toEqual([source]);
  });

  it("rejects a whole assignment if a seat was not in the job's profile snapshot", async () => {
    await queue();
    const assignment = createRotation(profiles, 17, 0, 2)[0]!;
    const claim = { token: "worker", now: 4 };
    await store.claimNextJob(claim.token, claim.now, 10);
    await store.putTableAssignments("job", [assignment, { ...assignment, north: { ...assignment.north, version: "other" } }], claim);
    expect(await store.listTableAssignments("job")).toEqual([]);
    await store.putTableAssignments("job", [assignment, assignment], claim);
    expect(await store.listTableAssignments("job")).toEqual([assignment, assignment]);
  });

  it("caps the active queue until a job reaches a terminal state", async () => {
    await queue();
    for (let index = 1; index < 8; index++) {
      const queued = await store.startJob({ id: `job-${index}`, cohortId: "cohort", roundIndex: index, now: index + 3 });
      expect(queued?.status).toBe("queued");
    }
    const next = { id: "next", cohortId: "cohort", roundIndex: 8, now: 20 };
    expect(await store.startJob(next)).toBeNull();
    await store.changeJobStatus("job", "pause", 21);
    expect(await store.startJob(next)).toBeNull();
    await store.changeJobStatus("job", "cancel", 22);
    expect((await store.startJob({ ...next, now: 23 }))?.status).toBe("queued");
  });

  it("caps lists even when an unbounded limit is requested internally", async () => {
    for (let index = 0; index <= MAX_BENCHMARK_PAGE; index++) {
      await store.addProfileVersion({ ...first!, version: `v${index}` }, index);
    }
    const page = await store.listProfiles(Number.MAX_SAFE_INTEGER);
    expect(page).toHaveLength(MAX_BENCHMARK_PAGE);
    expect(page[0]?.createdAt).toBe(MAX_BENCHMARK_PAGE);
    expect(await store.listProfiles(1)).toHaveLength(1);
  });
});
