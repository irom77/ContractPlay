import { contractText, type Contract, type Deal, type HandRecord, type Seat, type SkillLevel, type Vulnerability } from "@contractplay/core";
import type { TableStyle } from "@contractplay/protocol";
import type { BenchmarkProfileSnapshot, BenchmarkTableAssignment } from "@contractplay/benchmark";
import { castRoleOf, customCast, type BotCast } from "../soloSetup.js";

export type ReleasedPracticeResult = Readonly<{
  jobId: string;
  tableIndex: number;
  boardIndex: number;
  scoring: "imps" | "matchpoints";
  board: Readonly<{ number: number; deal: Deal; dealer: Seat; vulnerability: Vulnerability }>;
  assignment: BenchmarkTableAssignment;
  nsScore: number;
  contract: Contract | null;
  tricks: number | null;
  field: readonly Readonly<{ tableIndex: number; nsScore: number; contract: Contract | null; tricks: number | null }>[];
}>;

export type BenchmarkPracticeSetup = Readonly<{
  userSeat: Seat;
  cast: BotCast;
  biddingStyle: TableStyle;
  botSkill: SkillLevel;
  botAggression: BenchmarkProfileSnapshot["aggression"];
  record: HandRecord;
  benchmark: Readonly<{ profileId: string; version: string; sideScore: number; side: "NS" | "EW" }>;
}>;

/** Build a single-board practice deal from an already released, generated result and its complete duplicate field. */
export function createBenchmarkPractice(result: ReleasedPracticeResult, profileId: string, version: string): BenchmarkPracticeSetup | undefined {
  const userSeat = (Object.keys(result.assignment) as Seat[]).find((seat) => {
    const profile = result.assignment[seat];
    return profile.profileId === profileId && profile.version === version;
  });
  if (!userSeat || result.field.length < 2 || !result.field.some((row) => row.tableIndex === result.tableIndex)) return undefined;
  const selected = result.assignment[userSeat];
  let cast = customCast;
  for (const seat of Object.keys(result.assignment) as Seat[]) {
    if (seat === userSeat) continue;
    const role = castRoleOf(seat, userSeat);
    if (role) cast = { ...cast, [role]: result.assignment[seat].profileId };
  }
  const side = userSeat === "north" || userSeat === "south" ? "NS" : "EW";
  const record: HandRecord = {
    board: String(result.board.number),
    event: "Bot benchmark",
    scoring: result.scoring === "imps" ? "Cross-IMPs" : "Matchpoints",
    dealer: result.board.dealer,
    vulnerability: result.board.vulnerability,
    deal: result.board.deal,
    expectedFieldCount: result.field.length,
    field: result.field.map((row) => ({
      ...(row.contract ? { contract: contractText(row.contract), declarer: row.contract.declarer } : {}),
      ...(row.tricks === null ? {} : { tricks: row.tricks }),
      nsScore: row.nsScore,
      multiplicity: 1,
      artificial: false
    }))
  };
  return {
    userSeat,
    cast,
    biddingStyle: selected.biddingStyle,
    botSkill: selected.skill,
    botAggression: selected.aggression,
    record,
    benchmark: { profileId, version, side, sideScore: side === "NS" ? result.nsScore : -result.nsScore }
  };
}
