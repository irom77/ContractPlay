import { env } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { createBenchmarkProfile, benchmarkProfileVersionId, createRotation } from "@contractplay/benchmark";
import { applyAction, createDeck, createGameState, deal, SEATS, type GameAction } from "@contractplay/core";
import { BenchmarkStore } from "./benchmark-store.js";
import migration from "../migrations/0006_bot_benchmarks.sql?raw";

const store = new BenchmarkStore(env.DB);
const roster = (["beginner", "intermediate", "advanced", "expert"] as const).map(skill =>
  createBenchmarkProfile({ skill, aggression: "normal", version: "v1", engineVersion: "v1", biddingStyle: "SAYC" }));
const board = { number: 1, dealer: "north", vulnerability: "Both", deal: deal(createDeck()) } as const;
const auction = SEATS.map((seat, i) => ({ type: "bid", seat, bid: i === 0 ? "1notrump" : "pass" } as const));
function playBoard(actions: readonly GameAction[]) {
  let game = createGameState(board);
  for (const action of actions) {
    const next = applyAction(game, action);
    if (!next.ok) throw new Error(next.error.message);
    game = next.state;
  }
  return game;
}
beforeAll(async () => { await env.DB.exec(migration.replace(/--[^\n]*/g, "").replace(/\n/g, " ")); });

it("replays released bidding and card play, rates a mirrored session once and retains score history after replay expiry", async () => {
  for (const p of roster) await store.addProfileVersion(p, 1);
  expect(await store.createCohort("cohort", { name: "Mirrors", profiles: roster, boardCount: 1, maxTables: 2, biddingStyle: "SAYC",
    scoring: "matchpoints", rotationSeed: 1, importId: null, intervalMinutes: null }, 1)).toBe(true);
  await store.startJob({ id: "session", cohortId: "cohort", roundIndex: 0, now: 2 });
  const claim = { token: "claim", now: 3 };
  await store.claimNextJob(claim.token, claim.now, 1000);
  const first = createRotation(roster, 1, 0, 2)[0]!;
  const mirror = { north: first.east, east: first.south, south: first.west, west: first.north };
  await store.putTableAssignments("session", [first, mirror], claim);
  await store.putJobBoards("session", [board], claim);
  await store.startBoard("session", 0, claim);
  const actions: GameAction[] = [...auction];
  let game = playBoard(actions);
  while (game.phase === "play") {
    const seat = game.currentActor;
    const card = game.hands[seat].find(card => applyAction(game, { type: "play", seat, card }).ok)!;
    actions.push({ type: "play", seat, card });
    game = playBoard(actions);
  }
  const score = game.score!;
  const result = { jobId: "session", tableIndex: 0, boardIndex: 0, actions, contract: game.contract!, tricks: score.tricksTaken,
    nsScore: score.score, completedAt: 5 };
  expect(await store.recordResult(result)).toBe(true);
  expect(await store.getPublicResult("session", 0, 0)).toBeNull();
  expect(await store.listPublicResults()).toEqual([]);
  expect(await store.recordResult({ ...result, nsScore: score.score + 1 })).toBe(false);
  expect(await store.recordResult({ ...result, tableIndex: 1, actions: SEATS.map(seat => ({ type: "bid", seat, bid: "pass" })),
    contract: null, tricks: null, nsScore: 0 })).toBe(true);
  expect(await store.listPublicResults()).toEqual([]);
  expect(await store.getPublicResult("session", 0, 0)).toBeNull();
  expect(await store.finishRatedJob("session", "stale", 6)).toBe(false);
  expect(await store.listLeaderboard()).toEqual([]);
  expect(await store.finishRatedJob("session", "claim", 6)).toBe(true);
  expect(await store.finishRatedJob("session", "claim", 7)).toBe(true);
  expect((await store.listPublicResults()).every(item => item.replayAvailable)).toBe(true);
  const released = (await store.getPublicResult("session", 0, 0))!;
  expect(released.board).toEqual(board);
  expect(playBoard(released.actions)).toEqual(game);
  expect(released.nsScore).toBe(score.score);
  const summary = (await store.getSessionScores("session"))!;
  expect(summary.tables).toHaveLength(2);
  expect(summary.profiles).toHaveLength(4);
  expect(summary.profiles.every(p => p.sampleBoards === 1 && p.matchpoints.top === 2)).toBe(true);
  const ns = summary.profiles.find(p => p.competitorId === benchmarkProfileVersionId(first.north))!;
  expect(ns.crossImps).toBe(summary.tables[0]!.crossImps);
  const history = await store.listRatingHistory(ns.competitorId);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ jobId: "session", sampleBoards: 1, eligible: false });
  expect(await store.getProfileMetrics(ns.competitorId)).toMatchObject([{ scoring: "matchpoints", boards: 1, sessions: 1 }]);
  await store.retireProfileVersion(first.north, 9);
  await store.addProfileVersion({ ...first.north, version: "v2" }, 10);
  expect(await store.listLeaderboard()).not.toContainEqual(expect.objectContaining({ competitorId: ns.competitorId }));
  expect(await store.listRatingHistory(benchmarkProfileVersionId({ ...first.north, version: "v2" }))).toEqual([]);
  expect(await store.compactReplays(1000, 100)).toBe(1);
  expect(await store.getPublicResult("session", 0, 0)).toBeNull();
  expect(await store.listPublicResults()).toHaveLength(2);
  expect((await store.listPublicResults()).every(item => !item.replayAvailable && item.replayStatus === "expired")).toBe(true);
  expect(await store.getSessionScores("session")).toEqual(summary);
  expect(await store.listRatingHistory(ns.competitorId)).toEqual(history);
});
