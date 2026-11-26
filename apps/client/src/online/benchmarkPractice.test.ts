import { deal, type Contract } from "@contractplay/core";
import { expect, it } from "vitest";
import { createBenchmarkPractice, type ReleasedPracticeResult } from "./benchmarkPractice.js";

const makeProfile = (profileId: string, aggression: "conservative" | "normal" | "aggressive") => ({
  profileId, version: "v1", skill: "beginner" as const, aggression, biddingStyle: "SAYC" as const, engineVersion: "contractplay-bots-v1"
});
const assignment = { north: makeProfile("tess", "conservative"), east: makeProfile("ray", "normal"),
  south: makeProfile("eddie", "aggressive"), west: makeProfile("cora", "conservative") };
const contract: Contract = { level: 1, strain: "spades", doubled: 0, declarer: "north" };
const released: ReleasedPracticeResult = {
  jobId: "released", tableIndex: 0, boardIndex: 0, scoring: "imps",
  board: { number: 7, deal: deal(), dealer: "east", vulnerability: "Both" }, assignment,
  nsScore: 120, contract, tricks: 7,
  field: [
    { tableIndex: 0, nsScore: 120, contract, tricks: 7 },
    { tableIndex: 1, nsScore: -50, contract: null, tricks: null }
  ]
};

it("builds exact-seat practice against the assigned bots and compares against the released duplicate field", () => {
  const practice = createBenchmarkPractice(released, "cora", "v1");
  expect(practice).toMatchObject({
    userSeat: "west", biddingStyle: "SAYC", botSkill: "beginner", botAggression: "conservative",
    cast: { partner: "ray", left: "tess", right: "eddie" },
    benchmark: { profileId: "cora", version: "v1", sideScore: -120 }
  });
  expect(practice?.record).toMatchObject({
    board: "7", event: "Bot benchmark", scoring: "Cross-IMPs", dealer: "east", vulnerability: "Both",
    deal: released.board.deal,
    field: [
      { nsScore: 120, contract: "1S", declarer: "north", tricks: 7, multiplicity: 1, artificial: false },
      { nsScore: -50, multiplicity: 1, artificial: false }
    ]
  });
});

it("does not create practice when the selected profile is not in the released table assignment", () => {
  expect(createBenchmarkPractice(released, "pat", "v1")).toBeUndefined();
});
